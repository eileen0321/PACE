import type { FocusService } from './types';

// Android: AccessibilityService가 화이트리스트 앱 실행을 감지해 차단 화면(오버레이)을 띄우는 방식.
export const focusService: FocusService = {
  async requestAuthorization() {
    return true; // 접근성 권한은 별도 온보딩 플로우(설정 > 접근성)에서 안내
  },
  async setDailyLimit() {
    // NativeModules.PaceAccessibility.setDailyLimit(minutes) 연결 예정
  },
  async isBlocked() {
    return false;
  },
};
