import { create } from 'zustand';
import { fetchSearchPresets, fetchShortsPage, type SearchPreset } from '../services/api/youtube';
import { deviceCountry } from '../services/api/client';
import type { YouTubeShort } from '../types/models';

// 2026-08-10 파리티 — 안드 커밋 dd4dd06(쇼츠 검색, P메뉴 Search)의 iOS 이식.
// 프리셋(축구/야구 등)은 캐시가 잘 먹어 비용이 0에 가까워 무료 사용자도 횟수 제한 없이 연다
// (안드와 동일 — search-presets.ts 주석 참고). 자유 텍스트 검색은 안드도 아직 미구현이라
// (IME 포커스 문제) 여기서도 프리셋만 이식한다 — 이 스토어는 그래서 횟수 카운터가 없다.
const PRESET_TTL_MS = 60 * 60 * 1000; // 프리셋은 서버가 1시간 캐시하니 클라이언트도 맞춘다.

type ShortsSearchState = {
  presets: SearchPreset[];
  presetsFetchedAt: number;
  presetsLoading: boolean;
  results: Record<string, YouTubeShort[]>; // query별 결과 캐시(패널 열려 있는 동안만 의미 있음)
  resultsLoading: Record<string, boolean>;
  loadPresets: () => Promise<void>;
  search: (query: string) => Promise<void>;
};

export const useShortsSearchStore = create<ShortsSearchState>((set, get) => ({
  presets: [],
  presetsFetchedAt: 0,
  presetsLoading: false,
  results: {},
  resultsLoading: {},

  loadPresets: async () => {
    if (get().presetsLoading) return;
    if (get().presets.length > 0 && Date.now() - get().presetsFetchedAt < PRESET_TTL_MS) return;
    set({ presetsLoading: true });
    try {
      const presets = await fetchSearchPresets(deviceCountry());
      set({ presets, presetsFetchedAt: Date.now() });
    } catch {
      // 네트워크 실패 — 기존 프리셋(있으면) 유지, 조용히 무시.
    } finally {
      set({ presetsLoading: false });
    }
  },

  search: async (query) => {
    if (get().resultsLoading[query]) return;
    set((s) => ({ resultsLoading: { ...s.resultsLoading, [query]: true } }));
    try {
      const page = await fetchShortsPage({ query });
      set((s) => ({ results: { ...s.results, [query]: page.shorts } }));
    } catch {
      set((s) => ({ results: { ...s.results, [query]: s.results[query] ?? [] } }));
    } finally {
      set((s) => ({ resultsLoading: { ...s.resultsLoading, [query]: false } }));
    }
  },
}));
