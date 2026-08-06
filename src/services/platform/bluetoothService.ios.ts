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
// 표시할 때 쓰는 자리표시자(placeholder) 스텁이다 — Xcode/실기기가 없어 이번 라운드에서 실제
// 연결기기 조회(AVAudioSession) 네이티브 코드는 작성/검증하지 못했다. supportsHardwareRemote=false로
// 정직하게 표시(상위 UI가 이 값으로 "실기기 미검증" 배지를 조건부로 보여줄 수 있게).
export const bluetoothService: BluetoothService = {
  supportsHardwareRemote: false,

  async getState(): Promise<BluetoothState> {
    return {
      isConnected: false,
      deviceName: null,
      autoModeEnabled: false,
      nextCount: 0,
      previousCount: 0,
      autoToggleCount: 0,
    };
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
