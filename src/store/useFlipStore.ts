import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// PACE Flip Mode — "내려놓은 시간(쉬는 시간)" 측정 스토어 (스펙 §4-A, 2026-07-23).
// 기기를 엎어놓으면(face-down) 타이머 시작, 집어들면 그 경과를 오늘 누적에 더하고 크레딧을 적립한다.
// 날짜 스코프(useDailyBonusStore와 동일 패턴) — 자정이 지나면 자동 리셋.
//
// ⚠️ 핵심 제약과 대응(정상/비정상 처리, iOS+Android 공용):
//  - iOS는 폰을 엎으면 화면을 끄고 앱이 background로 가 CoreMotion이 멈춘다. Android는 기술적으로는
//    백그라운드에서도 SensorManager가 계속 동작하지만, 플랫폼 간 체감 차이를 없애려고 의도적으로
//    동일하게 "포그라운드/화면 켜진 상태에서만 인정"으로 통일했다(useFlipMode 훅 참고) — 그래서 두
//    플랫폼 다 이 스토어가 같은 background 브리징 로직을 필요로 한다. background 동안엔 센서 이벤트를
//    안 받으므로, 대신 "엎어놓은 시각(flipStartMs)"을 기록해 두고, 앱이 foreground로 돌아와 실제로
//    집어든 걸(physicalFaceDown=false) 확인하는 순간 그 사이 경과 전체를 정산한다(이 로직은 useFlipMode
//    훅이 AppState와 함께 처리).
//  - 앱이 background에서 강제종료(OOM/스와이프)돼도 flipStartMs를 AsyncStorage에 영속해 두어,
//    다음 콜드스타트(=앱을 다시 열었으니 face-up)에서 정산한다.
//  - "엎어둔 채 잊음/밤새 방치" 오검을 막으려 정산 경과에 상한(MAX_REST_SECONDS)을 둔다.
const KEY = 'pace_flip_today';
const CREDIT_PER_MINUTE = 1; // 쉬는 시간 1분당 집중 크레딧 1 (§1-A "쉬는 시간에 따른 집중 모드 보상")
const MAX_REST_SECONDS = 4 * 60 * 60; // 한 번의 쉼으로 인정하는 상한 4h (방치/밤샘 오검 방지)

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

type Persisted = {
  date: string;
  putDownSeconds: number;
  credits: number;
  flipStartMs: number | null; // 엎어놓은 시각(진행 중인 쉼) — kill 복구용으로 영속
};

type FlipState = {
  date: string;
  putDownSeconds: number; // 오늘 내려놓은 총 시간(초)
  credits: number; // 오늘 적립한 집중 크레딧
  isFaceDown: boolean;
  flipStartMs: number | null;

  load: () => Promise<void>;
  onFaceDown: () => void;
  onFaceUp: () => void;
  resetToday: () => void;
};

function persist(s: Persisted) {
  AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
}

// 진행 중인 쉼(flipStartMs)을 정산 → 오늘로 롤오버 + 상한 적용 + 크레딧 재계산 + 영속.
// 정산할 게 없으면(현재 상태) isFaceDown만 내린다. onFaceUp / load 복구 양쪽에서 재사용.
function settle(cur: { date: string; putDownSeconds: number; flipStartMs: number | null }): Partial<FlipState> {
  if (cur.flipStartMs == null) return { isFaceDown: false };
  const today = todayStr();
  // 자정을 넘겨 쉼이 이어졌으면 오늘 누적은 0에서 시작(어제 몫은 굳이 소급 배분하지 않음 — 단순/보수적).
  const basePutDown = cur.date === today ? cur.putDownSeconds : 0;
  const rawElapsed = Math.max(0, Math.round((Date.now() - cur.flipStartMs) / 1000));
  const elapsed = Math.min(rawElapsed, MAX_REST_SECONDS); // 방치/밤샘 오검 상한
  const putDownSeconds = basePutDown + elapsed;
  const credits = Math.floor(putDownSeconds / 60) * CREDIT_PER_MINUTE;
  persist({ date: today, putDownSeconds, credits, flipStartMs: null });
  return { date: today, putDownSeconds, credits, isFaceDown: false, flipStartMs: null };
}

export const useFlipStore = create<FlipState>((set, get) => ({
  date: todayStr(),
  putDownSeconds: 0,
  credits: 0,
  isFaceDown: false,
  flipStartMs: null,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const today = todayStr();
      if (!raw) {
        set({ date: today, putDownSeconds: 0, credits: 0, isFaceDown: false, flipStartMs: null });
        persist({ date: today, putDownSeconds: 0, credits: 0, flipStartMs: null });
        return;
      }
      const saved = JSON.parse(raw) as Partial<Persisted>;
      const sameDay = saved.date === today;
      const putDownSeconds = sameDay ? saved.putDownSeconds || 0 : 0;
      const credits = sameDay ? saved.credits || 0 : 0;
      // kill 복구: 진행 중이던 쉼(flipStartMs)이 영속돼 있으면 = background에서 강제종료됨.
      // 지금 콜드스타트 = 사용자가 앱을 다시 열었으니 face-up 상태 → 그 사이 경과를 정산(상한 적용).
      if (saved.flipStartMs != null) {
        set(settle({ date: saved.date || today, putDownSeconds, flipStartMs: saved.flipStartMs }));
        return;
      }
      set({ date: today, putDownSeconds, credits, isFaceDown: false, flipStartMs: null });
      if (!sameDay) persist({ date: today, putDownSeconds: 0, credits: 0, flipStartMs: null });
    } catch {
      set({ date: todayStr(), putDownSeconds: 0, credits: 0, isFaceDown: false, flipStartMs: null });
    }
  },

  // 엎어놓음 감지 → 타이머 시작 시각 기록 + 영속(kill 복구 대비). 이미 진행 중이면 무시(재진입 보호).
  onFaceDown: () => {
    const s = get();
    if (s.isFaceDown) return;
    const startMs = Date.now();
    set({ isFaceDown: true, flipStartMs: startMs });
    persist({ date: s.date, putDownSeconds: s.date === todayStr() ? s.putDownSeconds : 0, credits: s.credits, flipStartMs: startMs });
  },

  // 집어듦 감지 → 진행 중인 쉼을 정산(누적+크레딧+영속). 진행 중 아니면 no-op.
  onFaceUp: () => {
    const s = get();
    if (!s.isFaceDown && s.flipStartMs == null) return;
    set(settle(s));
  },

  resetToday: () => {
    const today = todayStr();
    set({ date: today, putDownSeconds: 0, credits: 0, isFaceDown: false, flipStartMs: null });
    persist({ date: today, putDownSeconds: 0, credits: 0, flipStartMs: null });
  },
}));
