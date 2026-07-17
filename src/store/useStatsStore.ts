import { create } from 'zustand';
import { getTodayUsageByApp, getTodayUsageMinutes, getTodayVideoStats, getWeeklyStats } from '../database/repositories/statsRepository';
import type { AppShieldTarget, DailyStats } from '../types/models';

type StatsState = {
  todayUsageMinutes: number;
  todayVideosWatched: number;
  todayAverageDurationSeconds: number;
  weeklyStats: DailyStats[];
  // overlay/index.tsx가 이제 실제 platform_app을 기록하면서 실사용 데이터로 채워짐(과거엔 항상
  // null이라 늘 빈 배열이었음) — PACE_ARCHITECTURE.md "비주얼 아이덴티티 전면 개편" 참고.
  platformBreakdown: { app: AppShieldTarget | 'other'; minutes: number }[];
  isLoading: boolean;
  refresh: (userId: string) => Promise<void>;
};

export const useStatsStore = create<StatsState>((set) => ({
  todayUsageMinutes: 0,
  todayVideosWatched: 0,
  todayAverageDurationSeconds: 0,
  weeklyStats: [],
  platformBreakdown: [],
  isLoading: false,

  refresh: async (userId) => {
    set({ isLoading: true });
    try {
      const [today, videoStats, weekly, platformBreakdown] = await Promise.all([
        getTodayUsageMinutes(userId),
        getTodayVideoStats(userId),
        getWeeklyStats(userId),
        getTodayUsageByApp(userId),
      ]);
      set({
        todayUsageMinutes: today,
        todayVideosWatched: videoStats.videosWatched,
        todayAverageDurationSeconds: videoStats.averageDurationSeconds,
        weeklyStats: weekly,
        platformBreakdown,
      });
    } finally {
      set({ isLoading: false });
    }
  },
}));
