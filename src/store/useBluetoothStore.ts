import { create } from 'zustand';
import { bluetoothService } from '../services/platform';
import { useToastStore } from './useToastStore';

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
  /** 이미 켜져 있으면 아무것도 안 하는 멱등 버전 — 매 세션 시작마다 불러도 안전(2026-07-23). */
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
    // 2026-07-21 밤 감사 발견 — 이 토글이 켜지면 네이티브에서 핑거스냅(PaceSnapDetector, RECORD_AUDIO
    // 필요)도 함께 시작되는데, 그 권한을 요청하는 JS 코드가 어디에도 없어 대부분의 실기기에서
    // 조용히 아무 반응도 없었다(네이티브가 권한 없으면 안전하게 no-op하도록만 방어돼 있었을 뿐).
    // 이 인앱 버튼이 "핸즈프리를 켜는" 유일한 JS 도달 경로라 여기서 먼저 물어본다 — 실제 스와이프
    // (알약 탭/블루투스 리모컨)는 100% 네이티브라 JS가 가로챌 수 없지만, 한 번이라도 이 경로로
    // 권한을 받아두면 이후 알약/리모컨 경로에서도 계속 동작한다.
    if (next) {
      const hasMic = await bluetoothService.hasRecordAudioPermission();
      if (!hasMic) await bluetoothService.requestRecordAudioPermission().catch(() => false);
      // 2026-07-24 손 밀어내기(shoo) 제스처 — 핑거스냅과 같은 진입점에서 같이 켜지므로 카메라
      // 권한도 여기서 같이 물어봐야 한다(안 그러면 핑거스냅과 똑같이 "권한 요청 코드가 어디에도
      // 없어서 조용히 죽어있는" 문제가 반복된다).
      const hasCamera = await bluetoothService.hasCameraPermission();
      if (!hasCamera) await bluetoothService.requestCameraPermission().catch(() => false);
    }
    await bluetoothService.toggleAutoMode(next);
    set({ autoModeEnabled: next, autoToggleCount: get().autoToggleCount + 1 });
    // iOS는 네이티브 토스트가 없으므로(하드웨어 리모컨 미구현) 인앱 버튼 탭에서는 여기서 직접 표시.
    useToastStore.getState().show(next ? '🎧 Focus Session Enabled' : '🎧 Focus Session Disabled');
  },

  enableAutoModeForSession: async () => {
    if (get().autoModeEnabled) return;
    const hasMic = await bluetoothService.hasRecordAudioPermission();
    if (!hasMic) await bluetoothService.requestRecordAudioPermission().catch(() => false);
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
