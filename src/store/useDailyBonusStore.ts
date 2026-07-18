import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';

// 2026-07-18 발견 버그 수정: Focus 탭의 "Extend Time"(+10/20/30m)이 useSettingsStore.dailyLimitMinutes를
// 직접 올려버려서 "오늘만" 늘려주려던 의도와 달리 다음날 이후에도 영구히 늘어난 한도가 유지됐다.
// dailyLimitMinutes는 영속 설정(기본값)이고, Extend Time은 "오늘 하루치 보너스"라 날짜가 바뀌면
// 자동으로 리셋되는 별도 저장소가 필요 — settings와 생명주기가 다르므로 분리한다.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type DailyBonusState = {
  date: string;
  extraMinutes: number;
  load: () => Promise<void>;
  addMinutes: (amount: number) => Promise<void>;
  /** Focus 탭 "Finish Session" 확인 시 사용 — 오늘 받은 보너스를 리셋. */
  resetToday: () => Promise<void>;
};

async function persist(date: string, extraMinutes: number) {
  await AsyncStorage.setItem(STORAGE_KEYS.dailyBonus, JSON.stringify({ date, extraMinutes }));
}

export const useDailyBonusStore = create<DailyBonusState>((set, get) => ({
  date: todayKey(),
  extraMinutes: 0,

  load: async () => {
    const today = todayKey();
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.dailyBonus);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved.date === today) {
          set({ date: today, extraMinutes: saved.extraMinutes ?? 0 });
          return;
        }
      } catch {
        // 손상된 값이면 아래 기본 리셋으로 폴백
      }
    }
    set({ date: today, extraMinutes: 0 });
  },

  addMinutes: async (amount) => {
    const today = todayKey();
    const base = get().date === today ? get().extraMinutes : 0;
    const next = base + amount;
    set({ date: today, extraMinutes: next });
    await persist(today, next);
  },

  resetToday: async () => {
    const today = todayKey();
    set({ date: today, extraMinutes: 0 });
    await persist(today, 0);
  },
}));
