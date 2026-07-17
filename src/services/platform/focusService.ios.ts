import type { FocusService } from './types';

// iOS: FamilyControls(AuthorizationCenter) + DeviceActivity + ManagedSettings(Shield).
// TODO(네이티브): AuthorizationCenter.shared.requestAuthorization() 브릿지, FamilyActivityPicker 화면.
export const focusService: FocusService = {
  async requestAuthorization() {
    return false; // 네이티브 모듈 연결 전까지 미지원으로 취급
  },
  async setDailyLimit() {
    // DeviceActivityMonitor 임계값 설정 연결 예정
  },
  async isBlocked() {
    return false;
  },
};
