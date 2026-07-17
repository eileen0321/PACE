import type { AppUsage, UsageService } from './types';

// iOS: DeviceActivity(FamilyControls) 기반. 앱별 상세 사용량은 Apple 정책상 앱 노출이 제한적이라
// 우선 Pace 자체 세션 기록(viewing_sessions) 합산으로 대체하고, DeviceActivityReport 연동은 후속 작업.
export const usageService: UsageService = {
  capability: 'full',
  async getTodayUsageMinutes() {
    return 0;
  },
  async getAppUsage(): Promise<AppUsage[]> {
    return [];
  },
};
