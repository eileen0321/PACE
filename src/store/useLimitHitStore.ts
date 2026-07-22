import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';

// 2026-07-22 사용자 지시 — 하루 한도 도달 알림을 1회성 다이얼로그 대신 단계적으로 완화되는
// 3단계로 바꾼다(1차: 풀 다이얼로그+선택지 → 2차: 완화된 다이얼로그+선택지 → 3차부터: 선택지 없이
// 1~3초 자동 소멸 토스트). 실제 스크린타임 앱 UX 리서치 결과 — 반복될수록 마찰을 키우기보다
// 줄이는 쪽이 표준(One Sec/Apple Screen Time 등, "매번 같은 세기"거나 오히려 완화 — 계속
// 풀 다이얼로그로 막으면 알림 피로로 그냥 무시하게 됨). useDailyBonusStore와 동일하게 날짜가
// 바뀌면 자동 리셋되는 하루 스코프 카운터.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type LimitHitState = {
  date: string;
  hitCount: number;
  load: () => Promise<void>;
  /**
   * 홈 화면이 "지금 몇 번째 도달 단계여야 하는지"(5분 단위 임계값 통과 횟수)를 계산해서 넘기면,
   * 저장된 hitCount가 그보다 낮을 때만 갱신 — 앱이 백그라운드에 있는 동안 여러 임계값을 건너뛴
   * 경우에도 한 번에 따라잡는다(순차 증가 대신 목표값 기반).
   */
  ensureAtLeast: (n: number) => Promise<void>;
  resetToday: () => Promise<void>;
};

async function persist(date: string, hitCount: number) {
  await AsyncStorage.setItem(STORAGE_KEYS.limitHits, JSON.stringify({ date, hitCount }));
}

export const useLimitHitStore = create<LimitHitState>((set, get) => ({
  date: todayKey(),
  hitCount: 0,

  load: async () => {
    const today = todayKey();
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.limitHits);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved.date === today) {
          set({ date: today, hitCount: saved.hitCount ?? 0 });
          return;
        }
      } catch {
        // 손상된 값이면 아래 기본 리셋으로 폴백
      }
    }
    set({ date: today, hitCount: 0 });
  },

  ensureAtLeast: async (n) => {
    const today = todayKey();
    const base = get().date === today ? get().hitCount : 0;
    if (n <= base) {
      if (get().date !== today) set({ date: today, hitCount: base });
      return;
    }
    set({ date: today, hitCount: n });
    await persist(today, n);
  },

  resetToday: async () => {
    const today = todayKey();
    set({ date: today, hitCount: 0 });
    await persist(today, 0);
  },
}));
