import { create } from 'zustand';

// 세션 중 남은 시간(Daily Limit) + Sleep Timer + Break Reminder 카운트다운.
// 오버레이 바(components/overlays)와 Live Activity(iOS)가 이 store를 구독해 표시를 갱신한다.
type TimerState = {
  isSessionActive: boolean;
  sessionId: string | null;
  remainingMinutes: number;
  sleepTimerRemainingMinutes: number | null;
  nextBreakInMinutes: number | null;
  startSession: (params: { sessionId: string; remainingMinutes: number; sleepTimerMinutes: number | null; breakIntervalMinutes: number }) => void;
  tickMinute: () => void;
  /** Extend Time(오버레이 확장 카드) — 세션 중 남은시간에 즉시 더한다. 호출부(overlay/index.tsx)가
   * 반환값으로 useDailyBonusStore 영속 + overlayService.updateRemaining() 네이티브 동기화까지 한다. */
  addMinutes: (minutes: number) => number;
  endSession: () => void;
};

export const useTimerStore = create<TimerState>((set, get) => ({
  isSessionActive: false,
  sessionId: null,
  remainingMinutes: 0,
  sleepTimerRemainingMinutes: null,
  nextBreakInMinutes: null,

  startSession: ({ sessionId, remainingMinutes, sleepTimerMinutes, breakIntervalMinutes }) => {
    set({
      isSessionActive: true,
      sessionId,
      remainingMinutes,
      sleepTimerRemainingMinutes: sleepTimerMinutes,
      nextBreakInMinutes: breakIntervalMinutes,
    });
  },

  tickMinute: () => {
    const s = get();
    if (!s.isSessionActive) return;
    const remaining = Math.max(0, s.remainingMinutes - 1);
    const sleep = s.sleepTimerRemainingMinutes != null ? Math.max(0, s.sleepTimerRemainingMinutes - 1) : null;
    const breakIn = s.nextBreakInMinutes != null ? s.nextBreakInMinutes - 1 : null;
    set({
      remainingMinutes: remaining,
      sleepTimerRemainingMinutes: sleep,
      nextBreakInMinutes: breakIn,
    });
    if (remaining <= 0 || sleep === 0) {
      get().endSession();
    }
  },

  addMinutes: (minutes) => {
    const s = get();
    if (!s.isSessionActive) return s.remainingMinutes;
    const remaining = s.remainingMinutes + minutes;
    set({ remainingMinutes: remaining });
    return remaining;
  },

  endSession: () => {
    set({ isSessionActive: false, sessionId: null, remainingMinutes: 0, sleepTimerRemainingMinutes: null, nextBreakInMinutes: null });
  },
}));
