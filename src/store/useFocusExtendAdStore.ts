import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';
import { focusAllowanceApi } from '../services/api/client';

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
    let localCount = 0;
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusExtendAdCount);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        if (saved.date === today) localCount = saved.count ?? 0;
      } catch {
        // 손상된 값이면 0으로 폴백
      }
    }
    set({ date: today, count: localCount });

    // 🔴 2026-08-10 사장님 지적("앱 지웠다 설치하면 계속 광고 보고 쓸 수 있는 거 아냐?") —
    //   이 카운터가 로컬에만 있어서 앱을 지우면 0으로 돌아갔다. 서버 기록(계정별, 게스트 포함)과
    //   합쳐 **더 많이 쓴 쪽**을 채택한다 — 재설치로 로컬이 비어도 서버가 기억한다.
    //   ⚠️ 실패는 조용히 삼킨다. 오프라인이라고 연장을 막으면 정상 사용자가 손해를 본다
    //     (반대 방향, 즉 비행기모드 우회는 다음 온라인 sync의 max 병합에서 회수된다).
    try {
      const server = await focusAllowanceApi.get(today);
      if (server.date === today && server.adExtendCount > get().count) {
        set({ date: today, count: server.adExtendCount });
        await persist(today, server.adExtendCount);
      }
    } catch {
      // 오프라인/미인증 — 로컬 값으로 계속 간다.
    }
  },

  increment: async () => {
    const today = todayKey();
    const base = get().date === today ? get().count : 0;
    const next = base + 1;
    set({ date: today, count: next });
    await persist(today, next);
    // 보상을 실제로 받은 순간에만 올라오는 값이라 그대로 서버에 남긴다(서버는 max로만 병합한다).
    try {
      await focusAllowanceApi.sync({ date: today, adExtendCount: next, timedOut: false, sessionEndsAt: null });
    } catch {
      // 오프라인이면 다음 load()에서 따라잡는다.
    }
  },
}));
