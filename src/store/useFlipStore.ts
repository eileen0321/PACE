import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// PACE Flip Mode — "내려놓은 시간(쉬는 시간)" 측정 스토어 (스펙 §4-A, 2026-07-23). iOS+Android 공용.
// 기기를 엎어놓으면(face-down) 타이머 시작, 집어들면 그 경과를 오늘 누적에 더하고 크레딧을 적립한다.
// 날짜 스코프(로컬 자정 기준) — 자정이 지나면 자동 리셋.
//
// ⚠️ 핵심 제약과 대응(정상/비정상 처리, iOS+Android 공용):
//  - iOS는 폰을 엎으면 화면을 끄고 앱이 background로 가 CoreMotion이 멈춘다. Android는 기술적으로는
//    백그라운드에서도 SensorManager가 동작하지만, 플랫폼 간 체감 차이를 없애려고 의도적으로 동일하게
//    "포그라운드/화면 켜진 상태에서만 인정"으로 통일했다(useFlipMode.ts 참고). 그래서 두 플랫폼 다
//    background 동안엔 센서 이벤트가 없으므로, "엎어놓은 시각(flipStartMs)"을 기록해 두고 foreground로
//    돌아와 실제로 집어든 걸(physicalFaceDown=false) 확인하는 순간 그 사이 경과 전체를 정산한다(브리징).
//  - 앱이 background에서 강제종료(OOM/스와이프)돼도 flipStartMs를 영속 → 다음 콜드스타트에서 정산.
//    단 "같은 날"일 때만(전날 이월된 시작시각은 거의 확실히 stale → 폐기, 감사 C2).
//  - "엎어둔 채 잊음/밤새 방치" 오검을 막으려 정산 경과에 상한(MAX_REST_SECONDS)을 둔다.
const KEY = 'pace_flip_today';
// 2026-07-26 사용자 지시 — 크레딧 계산식을 "1분=1크레딧" 선형에서 "10분당 5크레딧" 구간제로 변경
// (출석 +5와 합쳐 "20분 쉬면 15크레딧=15분 연속시청" 같은 계산이 나오게 하려는 의도, PACE_
// PROJECT_MANAGEMENT.md §6 2026-07-26 로그 참고 — Mac 세션도 동일 공식 적용해야 함).
const CREDITS_PER_BLOCK = 5;
const BLOCK_MINUTES = 10;
const MAX_REST_SECONDS = 4 * 60 * 60; // 한 번의 쉼으로 인정하는 상한 4h (방치/밤샘 오검 방지)

// 2026-07-26 사용자 지시("자는시간 등은 다 빼도록") — 웹리서치 결과(SleepTown 등) "이게 진짜 수면인지"를
// 알고리즘으로 판별하려 하지 않고, 수면을 아예 별도 시간대로 분리해 취급하는 게 업계 공통 패턴임을
// 확인(PACE_PROJECT_MANAGEMENT.md §6 참고). 심야 무진동 시간대(자정~오전 6시)는 실제로 쉬었더라도
// (Stats의 "오늘 쉰 시간" putDownSeconds에는 그대로 반영) 크레딧 적립 대상에서는 제외한다 — 밤새
// 엎어놓고 자기만 해도 크레딧이 쌓이는 것을 막기 위함. 4시간 상한(MAX_REST_SECONDS)과는 별개 안전장치
// (상한은 "한 번의 쉼이 너무 길면 자름", 이건 "애초에 이 시간대는 안 셈").
const QUIET_HOURS_START = 0; // 00:00
const QUIET_HOURS_END = 6; // 06:00

// 로컬 자정 기준 날짜(감사 C1 — toISOString()은 UTC라 KST 사용자는 오전 9시에 리셋되는 버그였다).
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// [startMs, endMs) 구간 중 심야(QUIET_HOURS_START~QUIET_HOURS_END) 시간대와 겹치는 초를 계산.
// 하루 이상 걸친 구간(예: 자정 전에 엎어놓고 다음날 낮까지)도 날짜별로 순회하며 정확히 계산한다.
function quietHoursOverlapSeconds(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  let excluded = 0;
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < endMs) {
    const quietStart = new Date(cursor);
    quietStart.setHours(QUIET_HOURS_START, 0, 0, 0);
    const quietEnd = new Date(cursor);
    quietEnd.setHours(QUIET_HOURS_END, 0, 0, 0);
    const overlapStart = Math.max(startMs, quietStart.getTime());
    const overlapEnd = Math.min(endMs, quietEnd.getTime());
    if (overlapEnd > overlapStart) excluded += (overlapEnd - overlapStart) / 1000;
    cursor.setDate(cursor.getDate() + 1);
  }
  return excluded;
}

type Persisted = {
  date: string;
  putDownSeconds: number;
  creditEligibleSeconds: number;
  creditsSpent: number;
  flipStartMs: number | null; // 엎어놓은 시각(진행 중인 쉼) — kill 복구용으로 영속
};

type FlipState = {
  date: string;
  putDownSeconds: number; // 오늘 내려놓은 총 시간(초) — 심야 시간대 포함, 항상 정직한 실측 통계(Stats용)
  // 2026-07-26 — 크레딧은 putDownSeconds가 아니라 creditEligibleSeconds(심야 제외분)의 함수다.
  // credits는 여전히 "오늘 사용 가능한 잔액(적립-소비)"을 그대로 노출.
  creditEligibleSeconds: number;
  credits: number;
  isFaceDown: boolean;
  flipStartMs: number | null;

  load: () => Promise<void>;
  onFaceDown: () => void;
  onFaceUp: () => void;
  rollDateIfNeeded: () => void;
  resetToday: () => void;
  /**
   * Focus Session 무료 한도(PaceAccessibilityService.autoSwipeCap) 연장에 크레딧을 쓴다 — 보상형
   * 광고와 동일한 extendAutoNextCap()을 부르되, 광고 대신 이 크레딧이 재원. 보유량 초과 요청은
   * 보유량만큼만 쓰고 실제로 쓴 양을 반환(호출부가 그 값으로 extendAutoNextCap을 부름) — 잔액 0이면
   * 0 반환(그냥 no-op, 에러 아님).
   */
  spendCredits: (amount: number) => number;
};

// 쓰기 직렬화(감사 M4) — fire-and-forget setItem들이 순서 뒤바뀌지 않게 체인으로 잇는다.
let writeChain: Promise<unknown> = Promise.resolve();
function persist(s: Persisted) {
  writeChain = writeChain.then(() => AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {}));
}

function creditsFor(creditEligibleSeconds: number): number {
  const minutes = creditEligibleSeconds / 60;
  return Math.floor(minutes / BLOCK_MINUTES) * CREDITS_PER_BLOCK;
}

function availableCredits(creditEligibleSeconds: number, creditsSpent: number): number {
  return Math.max(0, creditsFor(creditEligibleSeconds) - creditsSpent);
}

// 진행 중인 쉼(flipStartMs)을 정산 → 오늘로 롤오버 + 상한 적용 + 심야 제외 + 크레딧 재계산 + 영속.
// 정산할 게 없으면 isFaceDown만 내린다. onFaceUp / load 복구 양쪽에서 재사용.
function settle(cur: { date: string; putDownSeconds: number; creditEligibleSeconds: number; creditsSpent: number; flipStartMs: number | null }): Partial<FlipState> {
  if (cur.flipStartMs == null) return { isFaceDown: false };
  const today = todayStr();
  // 자정을 넘겨 쉼이 이어졌으면 오늘 누적은 0에서 시작(어제 몫은 굳이 소급 배분하지 않음 — 단순/보수적).
  const sameDay = cur.date === today;
  const basePutDown = sameDay ? cur.putDownSeconds : 0;
  const baseCreditEligible = sameDay ? cur.creditEligibleSeconds : 0;
  const creditsSpent = sameDay ? cur.creditsSpent : 0;
  const nowMs = Date.now();
  const rawElapsed = Math.max(0, Math.round((nowMs - cur.flipStartMs) / 1000));
  const elapsed = Math.min(rawElapsed, MAX_REST_SECONDS); // 방치/밤샘 오검 상한
  const quietExcluded = quietHoursOverlapSeconds(cur.flipStartMs, cur.flipStartMs + elapsed * 1000);
  const putDownSeconds = basePutDown + elapsed; // 실측 총 휴식(Stats용) — 심야 포함, 정직하게 전부 기록
  const creditEligibleSeconds = baseCreditEligible + Math.max(0, elapsed - quietExcluded); // 크레딧 계산용
  const credits = availableCredits(creditEligibleSeconds, creditsSpent);
  persist({ date: today, putDownSeconds, creditEligibleSeconds, creditsSpent, flipStartMs: null });
  return { date: today, putDownSeconds, creditEligibleSeconds, credits, isFaceDown: false, flipStartMs: null };
}

export const useFlipStore = create<FlipState>((set, get) => ({
  date: todayStr(),
  putDownSeconds: 0,
  creditEligibleSeconds: 0,
  credits: 0,
  isFaceDown: false,
  flipStartMs: null,

  load: async () => {
    // 진행 중인 쉼이 메모리에 이미 있으면(런치/포커스 리로드가 native onFlip보다 늦게 와도) 절대 덮지
    // 않는다(감사 H1/H3 — load가 진행 중 쉼을 죽이거나 flipStartMs를 되돌리는 레이스 차단).
    const activeInMemory = get().isFaceDown && get().flipStartMs != null;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const today = todayStr();
      const saved = raw ? (JSON.parse(raw) as Partial<Persisted>) : null;
      const sameDay = saved?.date === today;
      const putDownSeconds = sameDay ? saved?.putDownSeconds ?? 0 : 0;
      const creditEligibleSeconds = sameDay ? saved?.creditEligibleSeconds ?? 0 : 0;
      const creditsSpent = sameDay ? saved?.creditsSpent ?? 0 : 0;
      const credits = availableCredits(creditEligibleSeconds, creditsSpent);

      if (activeInMemory) {
        set({ date: today, putDownSeconds, creditEligibleSeconds, credits }); // 오늘 누적만 반영, 진행 중 쉼 보존
        return;
      }

      // kill 복구: 진행 중이던 쉼(flipStartMs)이 영속돼 있으면 = background에서 강제종료됨.
      if (saved?.flipStartMs != null) {
        if (sameDay) {
          // 같은 날 → 지금 콜드스타트(=앱을 다시 열었으니 face-up)에서 그 사이 경과를 정산(상한 적용).
          set(settle({ date: saved.date || today, putDownSeconds, creditEligibleSeconds, creditsSpent, flipStartMs: saved.flipStartMs }));
        } else {
          // 전날 이월된 진행 중 쉼 → stale로 보고 폐기(가짜 4h 적립 방지, 감사 C2). 오늘은 0부터.
          set({ date: today, putDownSeconds: 0, creditEligibleSeconds: 0, credits: 0, isFaceDown: false, flipStartMs: null });
          persist({ date: today, putDownSeconds: 0, creditEligibleSeconds: 0, creditsSpent: 0, flipStartMs: null });
        }
        return;
      }

      set({ date: today, putDownSeconds, creditEligibleSeconds, credits, isFaceDown: false, flipStartMs: null });
      if (!sameDay) persist({ date: today, putDownSeconds: 0, creditEligibleSeconds: 0, creditsSpent: 0, flipStartMs: null });
    } catch {
      if (!activeInMemory) set({ date: todayStr(), putDownSeconds: 0, creditEligibleSeconds: 0, credits: 0, isFaceDown: false, flipStartMs: null });
    }
  },

  // 엎어놓음 감지 → 시작시각 기록 + 영속(kill 복구 대비). 이미 진행 중이면 무시(재진입 보호, flipStartMs 보존).
  // 열린 채 자정 넘긴 경우 date를 오늘로 정규화(감사 H2/M1 — stale date로 inconsistent 영속 방지).
  onFaceDown: () => {
    const s = get();
    if (s.isFaceDown) return;
    const today = todayStr();
    const startMs = Date.now();
    const sameDay = s.date === today;
    const putDownSeconds = sameDay ? s.putDownSeconds : 0;
    const creditEligibleSeconds = sameDay ? s.creditEligibleSeconds : 0;
    const credits = sameDay ? s.credits : 0;
    set({ isFaceDown: true, flipStartMs: startMs, date: today, putDownSeconds, creditEligibleSeconds, credits });
    // sameDay면 기존 creditsSpent를 그대로 들고 가야 한다(방금 쓴 크레딧이 되살아나면 안 됨) — s에는
    // creditsSpent가 없으므로(파생값이라 상태에 없음) 역산해서 넘긴다. 다른 날이면(롤오버) 0부터.
    const existingSpent = sameDay ? creditsFor(s.creditEligibleSeconds) - s.credits : 0;
    persist({ date: today, putDownSeconds, creditEligibleSeconds, creditsSpent: existingSpent, flipStartMs: startMs });
  },

  // 집어듦 감지 → 진행 중인 쉼을 정산(누적+크레딧+영속). 진행 중 아니면 no-op.
  onFaceUp: () => {
    const s = get();
    if (!s.isFaceDown && s.flipStartMs == null) return;
    set(settle({
      date: s.date,
      putDownSeconds: s.putDownSeconds,
      creditEligibleSeconds: s.creditEligibleSeconds,
      creditsSpent: creditsFor(s.creditEligibleSeconds) - s.credits,
      flipStartMs: s.flipStartMs,
    }));
  },

  // 열린 채 자정을 넘겼을 때 표시/누적을 새 날로 롤오버(감사 H2). 진행 중 쉼은 유지(경과는 새 날에 정산).
  rollDateIfNeeded: () => {
    const s = get();
    const today = todayStr();
    if (s.date === today) return;
    set({ date: today, putDownSeconds: 0, creditEligibleSeconds: 0, credits: 0 });
    persist({ date: today, putDownSeconds: 0, creditEligibleSeconds: 0, creditsSpent: 0, flipStartMs: s.flipStartMs });
  },

  resetToday: () => {
    const today = todayStr();
    set({ date: today, putDownSeconds: 0, creditEligibleSeconds: 0, credits: 0, isFaceDown: false, flipStartMs: null });
    persist({ date: today, putDownSeconds: 0, creditEligibleSeconds: 0, creditsSpent: 0, flipStartMs: null });
  },

  spendCredits: (amount) => {
    const s = get();
    const today = todayStr();
    const sameDay = s.date === today;
    const putDownSeconds = sameDay ? s.putDownSeconds : 0;
    const creditEligibleSeconds = sameDay ? s.creditEligibleSeconds : 0;
    const currentCredits = sameDay ? s.credits : 0;
    const spent = Math.max(0, Math.min(Math.floor(amount), currentCredits));
    if (spent === 0) return 0;
    const priorSpent = creditsFor(creditEligibleSeconds) - currentCredits; // 이미 소비된 만큼 역산
    const creditsSpent = priorSpent + spent;
    const credits = currentCredits - spent;
    set({ date: today, putDownSeconds, creditEligibleSeconds, credits });
    persist({ date: today, putDownSeconds, creditEligibleSeconds, creditsSpent, flipStartMs: s.flipStartMs });
    return spent;
  },
}));
