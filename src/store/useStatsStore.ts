import { create } from 'zustand';
import { getTodayUsageByApp, getTodayUsageMinutes, getPreviousWeekStats, getWeeklyStats } from '../database/repositories/statsRepository';
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
  /** 오늘 사용시간을 앱별로 나눈 값 — 2026-08-12 사장님 지시로 부활(원본은 c0cb9b6에서 삭제됨).
   * 안 본 앱은 아예 안 들어온다. */
  todayUsageByApp: { app: string; minutes: number; seconds: number }[];
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
  todayUsageByApp: [],
  weeklyStats: [],
  previousWeekStats: [],
  focusScore: null,
  isLoading: false,

  refresh: async (userId) => {
    set({ isLoading: true });
    try {
      const [today, byApp, weekly, previousWeek] = await Promise.all([
        getTodayUsageMinutes(userId),
        getTodayUsageByApp(userId),
        getWeeklyStats(userId),
        getPreviousWeekStats(userId),
      ]);
      // 2026-08-12에 여기 진단용 console.log를 넣어 "앱별 사용시간 섹션이 안 뜨는" 원인을 잡았고
      // (총 110분 중 51분이 platform_app=NULL이었다), 2026-08-13 출시 준비에서 제거한다 —
      // 릴리즈 빌드에 사용자 데이터가 logcat으로 나가면 안 된다.
      const dailyLimitMinutes = useSettingsStore.getState().settings.dailyLimitMinutes;
      set({
        todayUsageMinutes: today,
        todayUsageByApp: byApp,
        weeklyStats: weekly,
        previousWeekStats: previousWeek,
        focusScore: computeFocusScore(weekly, dailyLimitMinutes),
      });
    } finally {
      set({ isLoading: false });
    }
  },
}));
