import type { BluetoothService, BluetoothState } from './types';

// modules/pace-overlay(Expo Modules API)의 Bluetooth Hands-Free 브릿지(2026-07-19) — 실제 스와이프/
// Auto Mode 토글/토스트는 PaceOverlayService.kt의 MediaSession 콜백이 네이티브에서 자기 완결적으로
// 처리한다(Daily Limit과 동일한 설계 원칙, PACE_ARCHITECTURE.md 참고). next()/previous()/
// toggleAutoMode()는 Focus 탭 등 "인앱 버튼 탭"이 하드웨어 리모컨과 같은 경로(PaceAccessibilityService
// .swipeOnce, MediaSession 상태 갱신)를 타도록 네이티브 함수를 직접 호출한다.
let PaceOverlay: {
  triggerSwipe(up: boolean): void;
  getBluetoothState(): BluetoothState;
  setBluetoothAutoMode(enable: boolean): void;
  setHandsFreeGestureEnabled(enable: boolean): void;
  setBluetoothVolumeKeySkipEnabled(enable: boolean): void;
  updateLiveSessionConfig(config: {
    breakIntervalMinutes: number;
    notifyRemaining: boolean;
    notifyLimit: boolean;
    notifyBreak: boolean;
    hardBlockMode: boolean;
  }): void;
  setSleepTimerMinutes(minutes: number): void;
  setFocusSessionDurationMinutes(minutes: number): void;
  getFocusSessionDurationMinutes(): number;
  setIsPremium(isPremium: boolean): void;
  setUseRealAds(useRealAds: boolean): void;
  setAdsConsent(canRequestAds: boolean, personalized: boolean): void;
  setAvailableCredits(credits: number): void;
  consumePendingCreditSpend(): number;
  setSleepStillnessMinutes(minutes: number): void;
  consumeFocusSessionTimedOut(): boolean;
  extendFocusSession(extraMinutes: number): void;
  hasRecordAudioPermission(): boolean;
  requestRecordAudioPermission(): Promise<{ status: string; granted: boolean }>;
  hasCameraPermission(): boolean;
  requestCameraPermission(): Promise<{ status: string; granted: boolean }>;
} | null = null;

try {
  PaceOverlay = require('../../../modules/pace-overlay').PaceOverlay;
} catch (e) {
  console.warn('[bluetoothService.android] pace-overlay 네이티브 모듈 미링크(Dev Client 빌드 필요) — Bluetooth Hands-Free 비활성화:', e);
}

const EMPTY_STATE: BluetoothState = {
  isConnected: false,
  deviceName: null,
  autoModeEnabled: false,
  nextCount: 0,
  previousCount: 0,
  autoToggleCount: 0,
};

// 네이티브 함수가 새로 추가된 직후(JS Fast Refresh는 됐는데 아직 네이티브 재빌드/재설치 전) PaceOverlay
// 객체 자체는 존재해도 해당 메서드가 없어 "undefined is not a function"으로 던지는 경우가 실기기에서
// 실제로 발생했다(2026-07-21, useBluetoothStore.refresh()의 Uncaught promise rejection으로 확인) —
// `?.`는 PaceOverlay가 null/undefined일 때만 막아주고 메서드 자체가 없는 경우는 못 막는다. try/catch로
// 감싸 항상 안전한 폴백값을 반환하도록 통일.
export const bluetoothService: BluetoothService = {
  supportsHardwareRemote: PaceOverlay !== null,

  async getState() {
    try {
      return PaceOverlay?.getBluetoothState() ?? EMPTY_STATE;
    } catch (e) {
      console.warn('[bluetoothService.android] getState failed', e);
      return EMPTY_STATE;
    }
  },

  async next() {
    try {
      PaceOverlay?.triggerSwipe(true);
    } catch (e) {
      console.warn('[bluetoothService.android] next failed', e);
    }
  },

  async previous() {
    try {
      PaceOverlay?.triggerSwipe(false);
    } catch (e) {
      console.warn('[bluetoothService.android] previous failed', e);
    }
  },

  async toggleAutoMode(enable: boolean) {
    try {
      PaceOverlay?.setBluetoothAutoMode(enable);
    } catch (e) {
      console.warn('[bluetoothService.android] toggleAutoMode failed', e);
    }
  },

  async setHandsFreeGestureEnabled(enable: boolean) {
    try {
      PaceOverlay?.setHandsFreeGestureEnabled(enable);
    } catch (e) {
      console.warn('[bluetoothService.android] setHandsFreeGestureEnabled failed', e);
    }
  },

  async setBluetoothVolumeKeySkipEnabled(enable: boolean) {
    try {
      PaceOverlay?.setBluetoothVolumeKeySkipEnabled(enable);
    } catch (e) {
      console.warn('[bluetoothService.android] setBluetoothVolumeKeySkipEnabled failed', e);
    }
  },

  async updateLiveSessionConfig(config) {
    try {
      PaceOverlay?.updateLiveSessionConfig(config);
    } catch (e) {
      console.warn('[bluetoothService.android] updateLiveSessionConfig failed', e);
    }
  },

  async setSleepTimerMinutes(minutes: number) {
    try {
      PaceOverlay?.setSleepTimerMinutes(minutes);
    } catch (e) {
      console.warn('[bluetoothService.android] setSleepTimerMinutes failed', e);
    }
  },

  async setFocusSessionDurationMinutes(minutes: number) {
    try {
      PaceOverlay?.setFocusSessionDurationMinutes(minutes);
    } catch (e) {
      console.warn('[bluetoothService.android] setFocusSessionDurationMinutes failed', e);
    }
  },

  // 2026-08-01 — 네이티브 "FOCUS OFF" 배지가 타임아웃 후 탭됐을 때 광고 없이 바로 재활성화할지
  // (프리미엄) 앱을 열어 보상형 광고 모달로 보낼지(무료) 판단하려면 네이티브가 구독 상태를 알아야
  // 한다 — isPremium이 바뀔 때마다 밀어준다(_layout.tsx).
  async setIsPremium(isPremium: boolean) {
    try {
      PaceOverlay?.setIsPremium(isPremium);
    } catch (e) {
      console.warn('[bluetoothService.android] setIsPremium failed', e);
    }
  },

  // 2026-08-02 — 쇼츠 위 FOCUS OFF 선택 팝업(광고/크레딧)이 크레딧 버튼을 보여줄지 판단하려면
  // 네이티브가 잔액을 알아야 한다(크레딧은 JS 스토어에만 존재) — 잔액이 바뀔 때마다 밀어준다.
  // 2026-08-03 출시 전 검증에서 발견 — 쇼츠 위 보상광고는 네이티브 액티비티가 띄우는데, 실광고 유닛을
  // 쓸지 테스트 유닛을 쓸지는 JS 빌드 플래그로만 알 수 있다. 안 밀어주면 출시 빌드에서도 테스트 광고만
  // 나간다(수익 0 + AdMob 정책 위반). 부팅 시 1회 밀어준다.
  async setUseRealAds(useRealAds: boolean) {
    try {
      PaceOverlay?.setUseRealAds(useRealAds);
    } catch (e) {
      console.warn('[bluetoothService.android] setUseRealAds failed', e);
    }
  },

  // 2026-08-04 출시 전 광고 감사 — 네이티브 보상형(PaceRewardedAdActivity)이 AdRequest를 그냥
  // build()해서 **UMP 동의를 전혀 반영하지 않고 있었다**. 동의는 JS(services/ads/adsConsent.ts)만
  // 알고 네이티브는 모르는데 그 배선이 없었던 것 — EEA 사용자가 개인화를 거부해도 이 광고는
  // 개인화로 요청됐다(정책 위반 소지). 동의 결과가 확정될 때마다 밀어준다.
  async setAdsConsent(canRequestAds: boolean, personalized: boolean) {
    try {
      PaceOverlay?.setAdsConsent(canRequestAds, personalized);
    } catch (e) {
      console.warn('[bluetoothService.android] setAdsConsent failed', e);
    }
  },

  async setAvailableCredits(credits: number) {
    try {
      PaceOverlay?.setAvailableCredits(Math.max(0, Math.floor(credits)));
    } catch (e) {
      console.warn('[bluetoothService.android] setAvailableCredits failed', e);
    }
  },

  // 네이티브 팝업에서 크레딧으로 연장한 분량을 1회성으로 회수(읽으면 즉시 리셋) — 실제 차감은 JS.
  async consumePendingCreditSpend() {
    try {
      return PaceOverlay?.consumePendingCreditSpend() ?? 0;
    } catch (e) {
      return 0;
    }
  },

  async getFocusSessionDurationMinutes() {
    try {
      return PaceOverlay?.getFocusSessionDurationMinutes() ?? 10;
    } catch (e) {
      console.warn('[bluetoothService.android] getFocusSessionDurationMinutes failed', e);
      return 10;
    }
  },

  async setSleepStillnessMinutes(minutes: number) {
    try {
      PaceOverlay?.setSleepStillnessMinutes(minutes);
    } catch (e) {
      console.warn('[bluetoothService.android] setSleepStillnessMinutes failed', e);
    }
  },

  async consumeFocusSessionTimedOut() {
    try {
      return PaceOverlay?.consumeFocusSessionTimedOut() ?? false;
    } catch (e) {
      console.warn('[bluetoothService.android] consumeFocusSessionTimedOut failed', e);
      return false;
    }
  },

  async extendFocusSession(extraMinutes: number) {
    try {
      PaceOverlay?.extendFocusSession(extraMinutes);
    } catch (e) {
      console.warn('[bluetoothService.android] extendFocusSession failed', e);
    }
  },

  async hasRecordAudioPermission() {
    try {
      return PaceOverlay?.hasRecordAudioPermission() ?? false;
    } catch (e) {
      console.warn('[bluetoothService.android] hasRecordAudioPermission failed', e);
      return false;
    }
  },

  async requestRecordAudioPermission() {
    try {
      const result = await PaceOverlay?.requestRecordAudioPermission();
      return result?.granted ?? false;
    } catch (e) {
      console.warn('[bluetoothService.android] requestRecordAudioPermission failed', e);
      return false;
    }
  },

  async hasCameraPermission() {
    try {
      return PaceOverlay?.hasCameraPermission() ?? false;
    } catch (e) {
      console.warn('[bluetoothService.android] hasCameraPermission failed', e);
      return false;
    }
  },

  async requestCameraPermission() {
    try {
      const result = await PaceOverlay?.requestCameraPermission();
      return result?.granted ?? false;
    } catch (e) {
      console.warn('[bluetoothService.android] requestCameraPermission failed', e);
      return false;
    }
  },

  // no-op — Android는 InputDevice.descriptor로 정적 연결 판정을 이미 정확히 하므로(getState()의
  // isConnected가 진실원천) iOS처럼 사후적 활동 신호가 필요 없다.
  reportRemoteActivity() {},
};

// iOS 전용 무음 관련 프로세스 전역 헬퍼의 안드로이드 스텁 — 공용 feed 코드가 임포트만 하고
// 실제 호출은 iOS 경로에서만 하지만, 만약 호출돼도 안전하게 no-op/기본값을 준다.
export function getLastKnownSilent(): boolean | null { return null; }
export function setLastKnownSilent(_silent: boolean): void {}
export function getUserSoundOn(): boolean { return false; }
export function setUserSoundOn(_on: boolean): void {}
