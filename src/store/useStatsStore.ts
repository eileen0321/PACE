import { create } from 'zustand';
import { getTodayUsageMinutes, getTodayVideoStats, getWeeklyStats } from '../database/repositories/statsRepository';
import type { DailyStats } from '../types/models';

type StatsState = {
  todayUsageMinutes: number;
  todayVideosWatched: number;
  todayAverageDurationSeconds: number;
  weeklyStats: DailyStats[];
  isLoading: boolean;
  refresh: (userId: string) => Promise<void>;
};

export const useStatsStore = create<StatsState>((set) => ({
  todayUsageMinutes: 0,
  todayVideosWatched: 0,
  todayAverageDurationSeconds: 0,
  weeklyStats: [],
  isLoading: false,

  refresh: async (userId) => {
    set({ isLoading: true });
    try {
      const [today, videoStats, weekly] = await Promise.all([
        getTodayUsageMinutes(userId),
        getTodayVideoStats(userId),
        getWeeklyStats(userId),
      ]);
      set({
        todayUsageMinutes: today,
        todayVideosWatched: videoStats.videosWatched,
        todayAverageDurationSeconds: videoStats.averageDurationSeconds,
        weeklyStats: weekly,
      });
    } finally {
      set({ isLoading: false });
    }
  },
}));
