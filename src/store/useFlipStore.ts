import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// PACE Flip Mode — "내려놓은 시간(쉬는 시간)" 측정 스토어 (스펙 §4-A, 2026-07-23).
// 기기를 엎어놓으면(face-down) 타이머 시작, 집어들면 그 경과를 오늘 누적에 더하고 크레딧을 적립한다.
// 날짜 스코프(useDailyBonusStore와 동일 패턴) — 자정이 지나면 자동 리셋.
// 네이티브 감지(iOS=modules/pace-flip)는 useFlipMode 훅이 담당하고, 이 스토어는 계측/영속만 한다.
const KEY = 'pace_flip_today';
const CREDIT_PER_MINUTE = 1; // 쉬는 시간 1분당 집중 크레딧 1 (§1-A "쉬는 시간에 따른 집중 모드 보상")

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

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

async function persist(date: string, putDownSeconds: number, credits: number) {
  await AsyncStorage.setItem(KEY, JSON.stringify({ date, putDownSeconds, credits })).catch(() => {});
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
      if (raw) {
        const saved = JSON.parse(raw) as { date: string; putDownSeconds: number; credits: number };
        if (saved.date === today) {
          set({ date: today, putDownSeconds: saved.putDownSeconds || 0, credits: saved.credits || 0 });
          return;
        }
      }
      // 저장 없음 or 날짜 바뀜 → 오늘로 리셋
      set({ date: today, putDownSeconds: 0, credits: 0 });
      persist(today, 0, 0);
    } catch {
      set({ date: todayStr(), putDownSeconds: 0, credits: 0 });
    }
  },

  // 엎어놓음 감지 → 타이머 시작 시각만 기록(누적은 집어들 때).
  onFaceDown: () => {
    if (get().isFaceDown) return;
    set({ isFaceDown: true, flipStartMs: Date.now() });
  },

  // 집어듦 감지 → 경과를 누적 + 크레딧 적립 + 영속. 날짜 바뀌었으면 먼저 리셋.
  onFaceUp: () => {
    const { isFaceDown, flipStartMs } = get();
    if (!isFaceDown) return;
    const today = todayStr();
    let base = get();
    if (base.date !== today) {
      // 자정 넘김 — 오늘로 리셋 후 이번 세션분만 반영
      base = { ...base, date: today, putDownSeconds: 0, credits: 0 };
    }
    const elapsedSec = flipStartMs ? Math.max(0, Math.round((Date.now() - flipStartMs) / 1000)) : 0;
    const putDownSeconds = base.putDownSeconds + elapsedSec;
    const credits = Math.floor(putDownSeconds / 60) * CREDIT_PER_MINUTE;
    set({ isFaceDown: false, flipStartMs: null, date: today, putDownSeconds, credits });
    persist(today, putDownSeconds, credits);
  },

  resetToday: () => {
    const today = todayStr();
    set({ date: today, putDownSeconds: 0, credits: 0, isFaceDown: false, flipStartMs: null });
    persist(today, 0, 0);
  },
}));
