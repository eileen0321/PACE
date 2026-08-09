import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';

// 2026-08-09 사용자 지시 — "보상광고 보고 포커스 타임 5분씩 주는거 무료에서 하루 3번으로 횟수 제한".
// useDailyBonusStore와 동일한 날짜-키 리셋 패턴(자정 지나면 자동으로 0으로 돌아옴).
export const FOCUS_EXTEND_AD_DAILY_LIMIT = 3;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type FocusExtendAdState = {
  date: string;
  count: number;
  load: () => Promise<void>;
  increment: () => Promise<void>;
};

async function persist(date: string, count: number) {
  await AsyncStorage.setItem(STORAGE_KEYS.focusExtendAdCount, JSON.stringify({ date, count }));
}

export const useFocusExtendAdStore = create<FocusExtendAdState>((set, get) => ({
  date: todayKey(),
  count: 0,

  load: async () => {
    const today = todayKey();
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusExtendAdCount);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved.date === today) {
          set({ date: today, count: saved.count ?? 0 });
          return;
        }
      } catch {
        // 손상된 값이면 아래 기본 리셋으로 폴백
      }
    }
    set({ date: today, count: 0 });
  },

  increment: async () => {
    const today = todayKey();
    const base = get().date === today ? get().count : 0;
    const next = base + 1;
    set({ date: today, count: next });
    await persist(today, next);
  },
}));
