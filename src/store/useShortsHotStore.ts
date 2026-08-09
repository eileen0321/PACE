import { create } from 'zustand';
import { shortsHotApi, type ShortsHotVideo } from '../services/api/client';

// 2026-08-01 사장님 지시 — Shorts HOT 리스트를 앱 시작 시 미리 로딩(Android 네이티브 프리페치와 동일
// 취지)해서, P 메뉴에서 Shorts HOT을 열면 로딩 스피너 없이 즉시 뜨게 한다. 카테고리별로 캐시하고,
// 열 때는 캐시를 먼저 보여준 뒤 백그라운드로 최신화한다(stale-while-revalidate).
//
// 2026-08-10 사용자 지적("너도 가져오는 횟수 조정하는거 아냐") — 맞는 말이었다. 서버 DB는
// `8d7ceb8`부터 2시간마다만 바뀌는데(백엔드 갱신 스케줄), 이 fetch()는 유효시간 개념이 없어
// 목록을 열 때마다·카테고리 탭을 바꿀 때마다 매번 새로 서버에 요청했다 — 어차피 2시간 안엔 서버
// 값이 그대로라 불필요한 왕복이었다. 서버 갱신 주기와 맞춰 클라이언트도 같은 TTL로 캐시한다.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 서버 갱신 스케줄(0 0 */2 * * *)과 동일하게 2시간.

type ShortsHotState = {
  cache: Record<string, ShortsHotVideo[]>;
  loading: Record<string, boolean>;
  fetchedAt: Record<string, number>;
  // 2026-08-01 사장님 지시(Android 7854a38 대응) — 이미 연 Shorts HOT 영상은 "본 것"으로 표시해
  // 다음에 리스트에서 뒤로 민다(안 본 것 우선). videoId만 기억(세션 한정, 마이그레이션/영속 불필요).
  opened: Record<string, true>;
  /** force=true면 TTL 무시하고 강제 재요청(사용자가 직접 새로고침하는 경우용 — 현재 UI엔 없지만 훅). */
  fetch: (category: string, force?: boolean) => Promise<void>;
  prefetch: () => void;
  markOpened: (videoId: string) => void;
};

export const useShortsHotStore = create<ShortsHotState>((set, get) => ({
  cache: {},
  loading: {},
  fetchedAt: {},
  opened: {},
  fetch: async (category, force = false) => {
    if (get().loading[category]) return;
    const last = get().fetchedAt[category];
    if (!force && last && Date.now() - last < CACHE_TTL_MS && get().cache[category]) return;
    set((s) => ({ loading: { ...s.loading, [category]: true } }));
    try {
      const rows = await shortsHotApi.list(category);
      set((s) => ({ cache: { ...s.cache, [category]: rows }, fetchedAt: { ...s.fetchedAt, [category]: Date.now() } }));
    } catch {
      // 네트워크 실패는 조용히 — 기존 캐시 유지(있으면 그대로 보여줌). fetchedAt은 안 갱신 —
      // 다음 시도 때 다시 실패한 요청으로 카운트되지 않게(성공한 fetch만 TTL을 연다).
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
