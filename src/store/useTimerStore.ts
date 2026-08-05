import { create } from 'zustand';

// 세션 중 남은 시간(Daily Limit) + Sleep Timer + Break Reminder 카운트다운.
// 오버레이 바(components/overlays)와 Live Activity(iOS)가 이 store를 구독해 표시를 갱신한다.
// 한 번의 틱에서 몰아서 깎을 수 있는 최대 분 — 네이티브(PaceOverlayService.MAX_CATCHUP_MINUTES)와
// 같은 값·같은 이유. 장시간 정지(백그라운드/절전) 뒤 복귀했을 때 보지도 않은 시간이 한 방에
// 사라지는 것을 막는다.
const MAX_CATCHUP_MINUTES = 5;

type TimerState = {
  isSessionActive: boolean;
  sessionId: string | null;
  remainingMinutes: number;
  sleepTimerRemainingMinutes: number | null;
  nextBreakInMinutes: number | null;
  /** 마지막으로 정산한 시각(Date.now()) — 아래 tickMinute 주석 참고. */
  lastTickAtMs: number;
  /** 1분에 못 미쳐 아직 반영하지 않은 잔여 시간(ms). 버리지 않고 이월한다. */
  carryMs: number;
  startSession: (params: { sessionId: string; remainingMinutes: number; sleepTimerMinutes: number | null; breakIntervalMinutes: number }) => void;
  tickMinute: () => void;
  resetTickClock: () => void;
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
  lastTickAtMs: 0,
  carryMs: 0,

  startSession: ({ sessionId, remainingMinutes, sleepTimerMinutes, breakIntervalMinutes }) => {
    set({
      isSessionActive: true,
      sessionId,
      remainingMinutes,
      sleepTimerRemainingMinutes: sleepTimerMinutes,
      nextBreakInMinutes: breakIntervalMinutes,
      // 새 세션은 측정 시계도 지금부터. 안 하면 이전 세션 종료 후 흐른 시간이 첫 틱에 몰려 깎인다.
      lastTickAtMs: Date.now(),
      carryMs: 0,
    });
  },

  // 🔴 2026-08-06 — 안드로이드 네이티브에서 실측으로 확인한 것과 **같은 부류의 결함**이 여기에도
  // 있었다. 네이티브는 "틱 1회 = 무조건 1분"으로 깎았는데 알람이 실제로는 105초마다 와서 일일
  // 한도가 약 1.75배로 늘어났다(PACE_PROJECT_MANAGEMENT.md 2026-08-06 항목).
  // 이 JS 틱도 정확히 같다 — `setInterval(60000)`은 정확하지 않고, 특히 iOS에서 앱이
  // 백그라운드/비활성으로 가면 스로틀링되거나 멈췄다가 나중에 몰려서 실행된다. 그때마다 1분씩만
  // 깎으면 실제로 흐른 시간보다 적게 깎여 **측정시간이 과소 집계된다**(= 사장님 표현으로 "돈").
  // iOS는 이 JS 틱이 카운트다운의 **유일한 소스**라(네이티브 카운트다운 없음) 영향이 그대로 간다.
  //
  // → 흐른 시간을 직접 재서 그만큼 깎는다. 1분에 못 미치는 잔여는 carryMs에 이월해 버리지 않는다.
  //   호출 주기가 흔들려도 총합이 정확해지고, 호출이 몰려도(0분 경과) 이중 차감이 없다.
  //   장시간 정지 뒤 한 번에 몰아 깎는 것은 MAX_CATCHUP_MINUTES로 상한을 둔다 — 그 구간은 보통
  //   실제로 안 보고 있던 시간이라 전부 깎으면 사용자에게 불리하다(네이티브와 동일한 정책).
  tickMinute: () => {
    const s = get();
    if (!s.isSessionActive) return;

    const now = Date.now();
    const since = s.lastTickAtMs > 0 && now > s.lastTickAtMs ? now - s.lastTickAtMs : 0;
    let carry = s.carryMs + since;
    let elapsedMinutes = Math.floor(carry / 60_000);
    carry -= elapsedMinutes * 60_000;
    if (elapsedMinutes > MAX_CATCHUP_MINUTES) {
      elapsedMinutes = MAX_CATCHUP_MINUTES;
      carry = 0;
    }
    if (elapsedMinutes <= 0) {
      set({ lastTickAtMs: now, carryMs: carry });
      return;
    }

    const remaining = Math.max(0, s.remainingMinutes - elapsedMinutes);
    const sleep = s.sleepTimerRemainingMinutes != null ? Math.max(0, s.sleepTimerRemainingMinutes - elapsedMinutes) : null;
    const breakIn = s.nextBreakInMinutes != null ? s.nextBreakInMinutes - elapsedMinutes : null;
    set({
      remainingMinutes: remaining,
      sleepTimerRemainingMinutes: sleep,
      nextBreakInMinutes: breakIn,
      lastTickAtMs: now,
      carryMs: carry,
    });
    if (remaining <= 0 || sleep === 0) {
      get().endSession();
    }
  },

  /** 측정 시계를 "지금부터"로 맞춘다. 실제로 보고 있지 않아 차감을 건너뛴 구간이 나중에 한꺼번에
   *  깎이지 않도록, 차감을 건너뛰는 쪽(overlay/index.tsx)이 매번 이걸 호출해 시계를 리셋한다. */
  resetTickClock: () => set({ lastTickAtMs: Date.now(), carryMs: 0 }),

  addMinutes: (minutes) => {
    const s = get();
    if (!s.isSessionActive) return s.remainingMinutes;
    const remaining = s.remainingMinutes + minutes;
    set({ remainingMinutes: remaining });
    return remaining;
  },

  endSession: () => {
    set({ isSessionActive: false, sessionId: null, remainingMinutes: 0, sleepTimerRemainingMinutes: null, nextBreakInMinutes: null, lastTickAtMs: 0, carryMs: 0 });
  },
}));
