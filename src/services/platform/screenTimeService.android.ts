import type { ScreenTimeService } from './types';

// Android는 Screen Time API(iOS 전용)가 없다 — 실제 숏폼 제어는 접근성/오버레이(overlayService.android +
// modules/pace-overlay)가 담당하므로 여기선 전부 no-op. supportsScreenTimeControl=false로 상위 UI가
// Screen Time 설정 항목을 iOS 전용으로 숨긴다.
export const screenTimeService: ScreenTimeService = {
  supportsScreenTimeControl: false,
  async requestAuthorization() {
    return false;
  },
  async isAuthorized() {
    return false;
  },
  async presentAppPicker() {},
  async startMonitoring() {},
  async stopMonitoring() {},
  async isShielded() {
    return false;
  },
};
