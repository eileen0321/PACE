import type { AppUsage, UsageService } from './types';

// TODO(네이티브): UsageStatsManager 브릿지 연결 전까지는 자리표시자(0) 반환.
export const usageService: UsageService = {
  capability: 'full',
  async getTodayUsageMinutes() {
    return 0;
  },
  async getAppUsage(): Promise<AppUsage[]> {
    return [];
  },
};
