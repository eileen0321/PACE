import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bluetoothService } from '../services/platform';
import { useToastStore } from './useToastStore';
import { useSettingsStore } from './useSettingsStore';
import { translate, resolveSystemLocale } from '../services/i18n';
import { STORAGE_KEYS } from '../services/storage/keys';

// notifications/index.ts의 currentLocale()과 동일한 패턴 — Zustand 액션은 컴포넌트가 아니라
// useTranslation() 훅을 못 쓰므로, 호출 시점에 fresh하게 현재 언어를 읽어 translate()에 넘긴다.
function currentLocale() {
  const language = useSettingsStore.getState().settings.language;
  return language === 'system' ? resolveSystemLocale() : language;
}

// 2026-07-19: Bluetooth Hands-Free Control 표시용 상태(Home 배지/Focus 카드/Settings 섹션 공용).
// Android: 실제 스와이프/토글/토스트/카운터는 네이티브(PaceOverlayService MediaSession)가 자기
// 완결적으로 처리하므로, 이 store의 역할은 (a) 화면 표시를 위해 refresh()로 네이티브 상태를 폴링,
// (b) 인앱 버튼 탭이 네이티브 함수를 직접 호출(= 하드웨어 리모컨과 동일 경로)하는 것 두 가지뿐 —
// Daily Limit의 consumeExpired와 같은 "네이티브가 진실원천, JS는 표시만" 설계 원칙을 그대로 따른다.
type BluetoothStoreState = {
  isConnected: boolean;
  deviceName: string | null;
  autoModeEnabled: boolean;
  nextCount: number;
  previousCount: number;
  autoToggleCount: number;
  /** Focus Session(자동넘김) 지속 시간(분) — 사용자가 직접 선택, 하드코딩 아님(2026-07-20 사용자 지시). */
  focusSessionDurationMinutes: number;
  refresh: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  toggleAutoMode: () => Promise<void>;
  /** 매 세션 시작마다 불러도 안전한 버전(2026-07-23) — 실제 멱등 보장은 네이티브
   * (PaceSnapDetector/PaceHandWaveDetector/PaceAccessibilityService가 각자 running 플래그로
   * 자체 방어)가 하므로 여기서 항상 네이티브를 부른다(2026-07-25 수정 근거는 구현부 주석 참고). */
  enableAutoModeForSession: () => Promise<void>;
  setFocusSessionDurationMinutes: (minutes: number) => Promise<void>;
};

export const useBluetoothStore = create<BluetoothStoreState>((set, get) => ({
  isConnected: false,
  deviceName: null,
  autoModeEnabled: false,
  nextCount: 0,
  previousCount: 0,
  autoToggleCount: 0,
  focusSessionDurationMinutes: 10,

  refresh: async () => {
    const [state, focusSessionDurationMinutes] = await Promise.all([
      bluetoothService.getState(),
      bluetoothService.getFocusSessionDurationMinutes(),
    ]);
    set({ ...state, focusSessionDurationMinutes });
  },

  next: async () => {
    await bluetoothService.next();
    // Android는 네이티브가 이미 토스트를 쐈다(PaceOverlayService.triggerNext) — 여기 별도 토스트 없음.
    // 폴링 주기를 기다리지 않고 카운터를 낙관적으로 반영(다음 refresh에서 정확한 값으로 정정됨).
    set({ nextCount: get().nextCount + 1 });
  },

  previous: async () => {
    await bluetoothService.previous();
    set({ previousCount: get().previousCount + 1 });
  },

  toggleAutoMode: async () => {
    const next = !get().autoModeEnabled;
    // 2026-07-24 손 밀어내기(shoo) 제스처 — 이 인앱 버튼이 "핸즈프리를 켜는" 유일한 JS 도달 경로라
    // 여기서 먼저 카메라 권한을 물어본다(실제 스와이프는 100% 네이티브라 JS가 가로챌 수 없지만,
    // 한 번이라도 이 경로로 권한을 받아두면 이후 알약/리모컨 경로에서도 계속 동작한다).
    // 2026-07-31 — 핑거스냅(마이크 필요)은 애플 통보로 양 플랫폼 다 비활성화된 죽은 기능이라
    // (capabilities.supportsFingerSnap===false) 마이크 권한 요청 제거 — 쓰지도 않는 권한을 요구하면
    // App Store 5.1.1 심사 리스크(불필요한 권한 요구)만 키운다.
    if (next) {
      const hasCamera = await bluetoothService.hasCameraPermission();
      if (!hasCamera) await bluetoothService.requestCameraPermission().catch(() => false);
    }
    await bluetoothService.toggleAutoMode(next);
    set({ autoModeEnabled: next, autoToggleCount: get().autoToggleCount + 1 });
    // 2026-07-27 사용자 실기기 지적("핸즈프리 껐는데 왜 계속 켜져있음") — home.tsx의 startSession()이
    // 세션을 시작할 때마다 AsyncStorage의 autoModeOptIn(온보딩에서 Enable을 고른 적 있는지, 한 번
    // true가 되면 영구 보존)을 읽어 true면 무조건 enableAutoModeForSession()을 다시 부른다. 근데 이
    // 토글은 그 키를 건드리지 않아서, 사용자가 여기서 방금 끈 선택은 저장 안 되고 다음 세션 시작에서
    // 그대로 덮어써졌다 — Focus 탭 스위치를 꺼도 다음 유튜브 진입 즉시 도로 켜지는 버그. 온보딩 화면
    // (dismissOnboarding)과 동일하게 여기서도 사용자의 최신 선택을 저장해 다음 세션 시작이 그 값을
    // 존중하게 한다.
    AsyncStorage.setItem(STORAGE_KEYS.autoModeOptIn, String(next)).catch(() => {});
    // iOS는 네이티브 토스트가 없으므로(하드웨어 리모컨 미구현) 인앱 버튼 탭에서는 여기서 직접 표시.
    useToastStore.getState().show(translate(currentLocale(), next ? 'home.focusSessionEnabledToast' : 'home.focusSessionDisabledToast'));
  },

  enableAutoModeForSession: async () => {
    // 2026-07-25 실기기 지적("손동작/핑거스냅 왜 계속 안 됨") — 여기 `if (get().autoModeEnabled)
    // return` 가드가 진짜 원인이었다. autoModeEnabled는 네이티브 SharedPreferences(PREF_AUTO_MODE,
    // 프로세스 재시작에도 살아남음)를 refresh()로 그대로 읽어온 값이라, "이전 세션에서 켰었다"만
    // 있어도 true로 남는다. 근데 실제 감지기(PaceSnapDetector/PaceHandWaveDetector)는 프로세스가
    // 죽으면(force-stop, 크래시, OS 회수) 같이 사라지는 인메모리 상태다 — 그래서 새 프로세스에서는
    // JS만 "이미 켜져 있다"고 믿고 네이티브를 아예 안 불러서, 실제로는 아무 감지기도 안 도는 상태로
    // 조용히 멈춰 있었다. 네이티브 쪽(PaceOverlayService.setAutoMode → 각 감지기의 자체 running
    // 가드)이 이미 멱등이므로, 여기서는 매번 그냥 부른다 — 중복 호출은 네이티브가 안전하게 no-op.
    // 2026-07-31 — 마이크 권한 요청 제거(핑거스냅 죽은 기능, 위 toggleAutoMode와 동일 사유).
    const hasCamera = await bluetoothService.hasCameraPermission();
    if (!hasCamera) await bluetoothService.requestCameraPermission().catch(() => false);
    await bluetoothService.toggleAutoMode(true);
    set({ autoModeEnabled: true });
  },

  setFocusSessionDurationMinutes: async (minutes) => {
    await bluetoothService.setFocusSessionDurationMinutes(minutes);
    set({ focusSessionDurationMinutes: minutes });
  },
}));
