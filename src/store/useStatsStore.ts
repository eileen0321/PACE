import { create } from 'zustand';
import { getTodayUsageMinutes, getPreviousWeekStats, getWeeklyStats } from '../database/repositories/statsRepository';
import { useSettingsStore } from './useSettingsStore';
import type { DailyStats } from '../types/models';

// 2026-07-18: focus_score는 PACE_ARCHITECTURE.md에 "산출 로직 미정의라 허상 데이터가 될 뻔했다"는
// 이유로 서버 스키마에서도 의도적으로 뺐던 값 — 여기서 로컬 데이터만으로 산출 가능한 정직한 정의를
// 붙인다: "이번 주 사용 기록이 있는 날 중, 일일 한도 이내로 마친 날의 비율"(0~100). 사용 기록이 아예
// 없으면 아직 평가할 근거가 없으므로 null(화면은 "기록 없음"으로 표시).
function computeFocusScore(weeklyStats: DailyStats[], dailyLimitMinutes: number): number | null {
  const daysWithUsage = weeklyStats.filter((d) => d.totalMinutes > 0);
  if (!daysWithUsage.length) return null;
  const daysWithinLimit = daysWithUsage.filter((d) => d.totalMinutes <= dailyLimitMinutes).length;
  return Math.round((daysWithinLimit / daysWithUsage.length) * 100);
}

type StatsState = {
  todayUsageMinutes: number;
  weeklyStats: DailyStats[];
  /** 지난주(-13일~-7일) 일별 원본 배열 — "지난주 대비 X%" 트렌드 계산용. stats.tsx가 이번 주
   * 경과일수와 같은 범위로 잘라서(요일 단위 공정 비교) 합산한다(2026-07-28 감사 수정,
   * 아래 weeklyStats 주석 참고 — 미리 합쳐서 total만 저장하면 이 잘라내기가 불가능했다). */
  previousWeekStats: DailyStats[];
  focusScore: number | null;
  isLoading: boolean;
  refresh: (userId: string) => Promise<void>;
};

export const useStatsStore = create<StatsState>((set) => ({
  todayUsageMinutes: 0,
  weeklyStats: [],
  previousWeekStats: [],
  focusScore: null,
  isLoading: false,

  refresh: async (userId) => {
    set({ isLoading: true });
    try {
      const [today, weekly, previousWeek] = await Promise.all([
        getTodayUsageMinutes(userId),
        getWeeklyStats(userId),
        getPreviousWeekStats(userId),
      ]);
      const dailyLimitMinutes = useSettingsStore.getState().settings.dailyLimitMinutes;
      set({
        todayUsageMinutes: today,
        weeklyStats: weekly,
        previousWeekStats: previousWeek,
        focusScore: computeFocusScore(weekly, dailyLimitMinutes),
      });
    } finally {
      set({ isLoading: false });
    }
  },
}));
