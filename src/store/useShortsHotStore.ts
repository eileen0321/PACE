import { create } from 'zustand';
import { shortsHotApi, type ShortsHotVideo } from '../services/api/client';

// 2026-08-01 사장님 지시 — Shorts HOT 리스트를 앱 시작 시 미리 로딩(Android 네이티브 프리페치와 동일
// 취지)해서, P 메뉴에서 Shorts HOT을 열면 로딩 스피너 없이 즉시 뜨게 한다. 카테고리별로 캐시하고,
// 열 때는 캐시를 먼저 보여준 뒤 백그라운드로 최신화한다(stale-while-revalidate).
type ShortsHotState = {
  cache: Record<string, ShortsHotVideo[]>;
  loading: Record<string, boolean>;
  // 2026-08-01 사장님 지시(Android 7854a38 대응) — 이미 연 Shorts HOT 영상은 "본 것"으로 표시해
  // 다음에 리스트에서 뒤로 민다(안 본 것 우선). videoId만 기억(세션 한정, 마이그레이션/영속 불필요).
  opened: Record<string, true>;
  fetch: (category: string) => Promise<void>;
  prefetch: () => void;
  markOpened: (videoId: string) => void;
};

export const useShortsHotStore = create<ShortsHotState>((set, get) => ({
  cache: {},
  loading: {},
  opened: {},
  fetch: async (category) => {
    if (get().loading[category]) return;
    set((s) => ({ loading: { ...s.loading, [category]: true } }));
    try {
      const rows = await shortsHotApi.list(category);
      set((s) => ({ cache: { ...s.cache, [category]: rows } }));
    } catch {
      // 네트워크 실패는 조용히 — 기존 캐시 유지(있으면 그대로 보여줌).
    } finally {
      set((s) => ({ loading: { ...s.loading, [category]: false } }));
    }
  },
  // 앱 시작 시 기본 카테고리('all')만 미리 받아둔다(나머지는 탭 선택 시 온디맨드 + 캐시).
  prefetch: () => { get().fetch('all').catch(() => {}); },
  markOpened: (videoId) => {
    if (get().opened[videoId]) return;
    set((s) => ({ opened: { ...s.opened, [videoId]: true } }));
  },
}));
