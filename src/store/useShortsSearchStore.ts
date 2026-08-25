import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSearchPresets, fetchShortsPage, type SearchPreset } from '../services/api/youtube';
import { deviceCountry } from '../services/api/client';
import type { YouTubeShort } from '../types/models';

// 2026-08-10 파리티 — 안드 커밋 dd4dd06(쇼츠 검색, P메뉴 Search)의 iOS 이식.
// 프리셋(축구/야구 등)은 캐시가 잘 먹어 비용이 0에 가까워 무료 사용자도 횟수 제한 없이 연다
// (안드와 동일 — search-presets.ts 주석 참고). 자유 텍스트 검색은 안드도 아직 미구현이라
// (IME 포커스 문제) 여기서도 프리셋만 이식한다 — 이 스토어는 그래서 횟수 카운터가 없다.
const PRESET_TTL_MS = 60 * 60 * 1000; // 프리셋은 서버가 1시간 캐시하니 클라이언트도 맞춘다.

// 🔴 2026-08-25 사장님 지시("유튜브 시작 영상은 그 사람이 최근 검색한 거 기반으로 시작해야") —
// 마지막 검색어를 영속해 다음 피드 시작 시드의 근거로 쓴다(useShortsQueueStore.loadInitial +
// _layout 부팅 워밍 참고). 7일 지난 검색어는 "최근 관심사"로 보기 어려워 무시한다.
const LAST_SEARCH_KEY = 'pace_last_search_v1';
export const RECENT_SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 사용자가 **직접** 검색한 순간에만 부른다(오버레이의 프리셋 탭/입력 제출). search() 안에서 부르면
 *  부팅 워밍(_layout)이 매번 타임스탬프를 갱신해 검색어가 영원히 안 늙는다 — 그래서 분리했다. */
export function recordSearch(query: string) {
  AsyncStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({ query, at: Date.now() })).catch(() => {});
}

export async function getRecentSearchQuery(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SEARCH_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { query?: string; at?: number };
    if (!saved.query || typeof saved.at !== 'number') return null;
    if (Date.now() - saved.at > RECENT_SEARCH_TTL_MS) return null;
    return saved.query;
  } catch {
    return null;
  }
}

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
