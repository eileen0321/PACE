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

export const bluetoothService: BluetoothService = {
  supportsHardwareRemote: PaceOverlay !== null,

  async getState() {
    return PaceOverlay?.getBluetoothState() ?? EMPTY_STATE;
  },

  async next() {
    PaceOverlay?.triggerSwipe(true);
  },

  async previous() {
    PaceOverlay?.triggerSwipe(false);
  },

  async toggleAutoMode(enable: boolean) {
    PaceOverlay?.setBluetoothAutoMode(enable);
  },
};
