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
  setFocusSessionDurationMinutes(minutes: number): void;
  getFocusSessionDurationMinutes(): number;
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

  async setFocusSessionDurationMinutes(minutes: number) {
    try {
      PaceOverlay?.setFocusSessionDurationMinutes(minutes);
    } catch (e) {
      console.warn('[bluetoothService.android] setFocusSessionDurationMinutes failed', e);
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
};
