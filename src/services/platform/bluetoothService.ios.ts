import { requireOptionalNativeModule } from 'expo-modules-core';
import type { BluetoothService, BluetoothState } from './types';

// 카메라 권한만 쓰는 최소 타입 — pace-gesture 모듈의 전체 API를 여기서 알 필요는 없다
// (전체 사용은 hooks/useFeedRemoteControl.ios.ts가 담당).
type GestureCameraPermission = {
  cameraPermissionStatus(): string;
  requestCameraPermission(): Promise<boolean>;
};

// 2026-07-19: iOS 하드웨어 리모컨(AirPods 등) 이벤트 자체는 app/feed/index.tsx가
// hooks/useFeedRemoteControl.ios.ts(react-native-track-player)로 직접 수신·처리한다(Pace Feed
// 화면 안에서만 의미 있는 조작이라 화면 로컬 상태로 충분 — 전역 서비스로 뺄 이유가 없음).
// 이 파일은 Home/Focus/Settings 등 화면 밖 UI가 "지금 Bluetooth Hands-Free가 준비돼 있다"를
// 표시할 때 쓰는 자리표시자(placeholder) 스텁이었다.
//
// 🔴 2026-08-14 사장님 지적("블루투스 리모컨 옆에 안드처럼 녹색불 만들었어? 제대로 동작해?") —
//   처음엔 modules/pace-gesture/ios/PaceGestureModule.swift의 isBluetoothAudioConnected()
//   (AVAudioSession.currentRoute 기반)를 연결했는데, 2026-08-15 실기기 재확인 결과 **오디오
//   프로파일로 안 잡히는 저가 BT 클리커(순수 HID)는 애초에 currentRoute에 안 나타나** 영영
//   회색이었다(반대로 이름 모를 BT "오디오" 기기는 리모컨이 아닌데도 초록이 되는 정반대 오류도
//   있었음). 웹서치 재확인 — iOS는 서드파티 앱에 HID 기기의 연결 상태를 절대 노출하지 않는다
//   (Android InputDevice.descriptor에 대응하는 API가 구조적으로 없음, Apple Developer Forums·
//   공식 문서로 확인). 그래서 "지금 연결돼 있는가"를 정적으로 판정하는 건 iOS에서 불가능하다고
//   결론 — 대신 실제 리모컨 키 입력(onVolumeButton, useVolumeNext.ios.ts가 보고)이 있었던 시각을
//   기준으로 "최근에 감지됨"만 보여준다(REMOTE_ACTIVITY_WINDOW_MS 이내). 이 신호는 리모컨이 실제로
//   동작하는 /feed 화면 안에서만 발생하므로(PaceVolumeKey.start()가 거기서만 켜짐), 점도 그
//   화면(top bar)에서 봐야 의미가 있다 — Focus 탭의 점은 항상 회색이어도 정상(사장님 승인,
//   "2번" 방안: 화면 이동 + 정직한 사후적 표시).
let lastRemoteActivityAtMs: number | null = null;
// ⚠️ feed/index.tsx의 REMOTE_MUTE_SUPPRESS_WINDOW_MS(무음 강제해제 억제 창)와 같은 값으로 맞춰야 한다
// — 배지가 회색이 됐는데 폰 볼륨버튼은 계속 안 먹히는(또는 반대) 불일치를 막기 위한 의도적 중복.
const REMOTE_ACTIVITY_WINDOW_MS = 60_000;

// 🔴 2026-08-15 사장님 실기기 재현("계속 재현되는데") — 콜드 스타트 무음샘(feed/index.tsx의
// lastKnownSilentRef)이 화면(useRef) 로컬이라, 피드 화면에 새로 들어갈 때마다(재시작·재진입)
// "무음스위치를 아직 한 번도 확인 못한" 상태가 매번 새로 생겼다 — 매 재현마다 정직하게 재현된
// 것이었다. 이 값을 앱 프로세스 전체 생명주기 동안 기억하는 모듈 레벨 값으로 옮긴다 — 진짜
// "이 프로세스에서 처음 여는 순간"에만 모르는 상태고, 그 뒤로는(피드를 나갔다 다시 들어와도)
// 마지막으로 확인된 값을 즉시 쓴다. null=아직 한 번도 확인 안 됨(그때만 유튜브의 "먼저 소리로
// 시도" 기본 동작이 살아있음 — 이건 구조적으로 못 없앤다, checkSilentSwitch 자체가 비동기라
// 앱이 그 첫 응답을 받기 전엔 iOS 스위치 상태를 알 방법이 아예 없다).
let lastKnownSilent: boolean | null = null;

// feed/index.tsx가 매번 새로 useRef 만드는 대신 이 프로세스 레벨 값을 읽고/쓴다 — 위 주석 참고.
export function getLastKnownSilent(): boolean | null {
  return lastKnownSilent;
}
export function setLastKnownSilent(silent: boolean): void {
  lastKnownSilent = silent;
}

// 2026-08-18 사장님 재현("볼륨키로 소리 들리다가 앱 갔다 다시 쇼츠 열면 소리가 안 나 — 한 번 켜면
// 계속 나야지") — "사용자가 볼륨키로 소리를 켰다"(userSilentOverride)가 피드 화면 useRef 로컬이라
// 재진입마다 리셋되고, 무음스위치 강제가 다시 덮었다. lastKnownSilent과 동일한 처방: 앱 프로세스
// 전역으로 승격. 프로세스가 살아있는 한(앱을 완전히 껐다 켜기 전까지) 사용자의 "소리 켬" 의사를 기억.
let userSoundOn = false;
export function getUserSoundOn(): boolean {
  return userSoundOn;
}
export function setUserSoundOn(on: boolean): void {
  userSoundOn = on;
}

export const bluetoothService: BluetoothService = {
  supportsHardwareRemote: false,

  async getState(): Promise<BluetoothState> {
    const isConnected =
      lastRemoteActivityAtMs != null && Date.now() - lastRemoteActivityAtMs < REMOTE_ACTIVITY_WINDOW_MS;
    return {
      isConnected,
      // 사후적 활동 신호만 있고 기기 이름은 어차피 iOS에서 못 얻는다(위 주석 참고) — 항상 null.
      deviceName: null,
      autoModeEnabled: false,
      nextCount: 0,
      previousCount: 0,
      autoToggleCount: 0,
    };
  },

  reportRemoteActivity() {
    lastRemoteActivityAtMs = Date.now();
  },

  async next() {},
  async previous() {},
  async toggleAutoMode() {},
  async setHandsFreeGestureEnabled() {}, // no-op — handsFreeGesture는 순수 JS 설정, feed/index.tsx가 직접 읽음
  async setBluetoothVolumeKeySkipEnabled() {}, // no-op — iOS는 volumeKeyRemote를 feed/index.tsx가 직접 읽음
  async updateLiveSessionConfig() {}, // no-op — iOS는 이 설정들을 feed/index.tsx의 JS tick이 직접 참조
  async setSleepTimerMinutes() {}, // no-op — iOS는 취침 타이머 네이티브 경로 자체가 없음(feed/index.tsx의 JS setTimeout이 직접 sleepTimerMinutes를 읽음)
  async setFocusSessionDurationMinutes() {},
  async getFocusSessionDurationMinutes() { return 10; },
  async setIsPremium() {}, // no-op — iOS엔 이 네이티브 "FOCUS OFF" 배지/오버레이 알약 자체가 없음
  // no-op — 광고 연장 하루 제한이 Android 네이티브(MAX_AD_EXTENDS_PER_DAY)에만 있고,
  // iOS는 dev 우회가 이미 RN 쪽에 있다(types.ts의 setTestMode 주석 참고).
  async setTestMode() {},
  async setUseRealAds() {},
  async setAdsConsent() {}, // no-op — iOS는 쇼츠 위 네이티브 광고 경로가 없다(RN이 직접 동의를 반영)
  async setAvailableCredits() {}, // no-op — iOS엔 쇼츠 위 네이티브 선택 팝업이 없음(RN 모달로 처리)
  async consumePendingCreditSpend() { return 0; }, // no-op — 위와 동일 이유
  async setSleepStillnessMinutes() {}, // no-op — iOS는 sleepStillnessMinutes 네이티브 경로 자체가 없음
  async consumeFocusSessionTimedOut() { return false; },
  async extendFocusSession() {},
  async hasRecordAudioPermission() { return true; },
  async requestRecordAudioPermission() { return true; },
  // 🔴 2026-08-06 크로스플랫폼 감사 — 여기가 **true 하드코딩**이라 iOS에서 카메라 권한을 한 번도
  //   안 묻는 경로가 있었다.
  //   iOS에는 실제 권한 API가 이미 있다(modules/pace-gesture PaceGestureModule.swift —
  //   cameraPermissionStatus() / requestCameraPermission(), AVCaptureDevice 기반). 그런데 화면 중
  //   focus.tsx만 그걸 **iOS 전용 분기로 직접** 호출하고, 공용 경로인
  //   useBluetoothStore.toggleAutoMode()/enableAutoModeForSession()은 플랫폼 분기 없이 이 서비스만
  //   쓴다 → iOS에서 그 경로로 핸즈프리를 켜면 권한이 notDetermined여도 "이미 있다"고 답해
  //   프롬프트가 안 뜨고, 손짓은 조용히 안 된다.
  //   이건 types.ts가 안드로이드에서 겪었다고 기록한 바로 그 버그와 **같은 클래스**다
  //   ("권한을 물어본 적 자체가 없어 대부분의 실기기에서 핑거스냅이 영원히 죽어있었다").
  // → 실제 모듈에 위임한다. 이러면 공용 호출부가 양 플랫폼에서 동일하게 동작한다(진짜 공통화).
  //   모듈이 없는 환경(시뮬레이터/미링크)에서는 예전처럼 true로 폴백 — 권한 개념이 없는 곳에서
  //   false를 주면 상위가 무한히 요청을 반복한다.
  async hasCameraPermission() {
    const mod = requireOptionalNativeModule<GestureCameraPermission>('PaceGesture');
    if (!mod?.cameraPermissionStatus) return true;
    try {
      return mod.cameraPermissionStatus() === 'authorized';
    } catch {
      return true;
    }
  },
  async requestCameraPermission() {
    const mod = requireOptionalNativeModule<GestureCameraPermission>('PaceGesture');
    if (!mod?.requestCameraPermission) return true;
    try {
      return await mod.requestCameraPermission();
    } catch {
      return false;
    }
  },
};
