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

// 🔴 2026-08-25 사장님("왜 쇼츠 시작할 때 사용자의 최근 검색 단어를 확인해서 시작해야지 정해진
//   것만 하냐") — 저장하던 게 **검색어 하나뿐**이었다. 결과 목록은 zustand 메모리에만 있어서
//   콜드 스타트마다 네트워크로 다시 받아야 했고, 피드의 loadInitial은 "네트워크 대기 없음"
//   원칙이라 그걸 **기다리지 않는다** — 워밍이 늦으면 그대로 공용 seedPool로 떨어졌다.
//   (바로 옆 seedPool 경로는 같은 레이스를 이미 알고 resolveVideoIdWithPrefetch(..., null)로
//    끝까지 기다리게 만들어 뒀다 — 새 경로만 그 보호가 없었다.)
//   → 결과 목록도 같이 저장한다. 그러면 콜드 스타트에서 네트워크를 한 번도 안 기다리고
//     검색 기반 시드가 잡힌다. 저장은 최신 검색 하나뿐이라 용량도 고정이다.
const RECENT_RESULTS_KEY = 'pace_last_search_results_v1';
const RECENT_RESULTS_MAX = 30;

/** 시드로 이미 쓴 영상 — 같은 검색어로 매번 같은 영상이 나오지 않게 돌려 쓴다(아래 주석 참고). */
const SEED_USED_KEY = 'pace_seed_used_v1';
const SEED_USED_MAX = 30;

async function persistRecentResults(query: string, shorts: YouTubeShort[]) {
  try {
    const recent = await getRecentSearchQuery();
    if (recent !== query) return; // 최근 검색어의 결과만 저장한다(프리셋 탐색 결과까지 쌓지 않는다)
    await AsyncStorage.setItem(
      RECENT_RESULTS_KEY,
      JSON.stringify({ query, shorts: shorts.slice(0, RECENT_RESULTS_MAX) })
    );
  } catch {
    /* 저장 실패는 무시 — 다음 부팅에 메모리 워밍으로 폴백된다 */
  }
}

/** 저장된 최근 검색 결과. 검색어가 바뀌었거나 TTL이 지났으면 없는 것으로 본다. */
export async function getRecentSearchResults(): Promise<YouTubeShort[]> {
  try {
    const recent = await getRecentSearchQuery();
    if (!recent) return [];
    const raw = await AsyncStorage.getItem(RECENT_RESULTS_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as { query?: string; shorts?: YouTubeShort[] };
    if (saved.query !== recent || !Array.isArray(saved.shorts)) return [];
    return saved.shorts;
  } catch {
    return [];
  }
}

/**
 * 후보 중 **아직 시드로 안 쓴 것**을 고르고 그 사실을 기록한다.
 *
 * 🔴 이게 필요한 이유: 원래 코드는 `find(watchedIds에 없는 것)`으로 골랐는데, iOS 스와이프
 *   모드에서는 useShortsQueueStore.advance()가 **한 번도 안 불린다**(feed/index.tsx의 SWIPE_NAV
 *   분기가 playerRef.advance()만 부른다). watchedIds를 늘리는 곳이 거기뿐이라 그 목록은 영원히
 *   비어 있고, 결과적으로 항상 results[0] — 사장님이 보신 "정해진 것만"이 정확히 이것이다.
 *   watchedIds를 고치는 건 재생 구조를 건드리는 일이라, 시드 선택은 **자기 기록**으로 돌린다.
 */
export async function pickUnusedSeed(candidates: YouTubeShort[]): Promise<YouTubeShort | null> {
  if (candidates.length === 0) return null;
  let used: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(SEED_USED_KEY);
    if (raw) used = JSON.parse(raw) as string[];
  } catch {
    used = [];
  }
  // 후보를 다 돌았으면 기록을 비우고 처음부터 — "정해진 것만"으로 굳지 않게 한 바퀴씩 돈다.
  let pick = candidates.find((c) => !used.includes(c.videoId));
  if (!pick) {
    used = [];
    pick = candidates[0];
  }
  try {
    await AsyncStorage.setItem(SEED_USED_KEY, JSON.stringify([...used, pick.videoId].slice(-SEED_USED_MAX)));
  } catch {
    /* 기록 실패 — 다음 진입에 같은 영상이 한 번 더 나올 뿐이다 */
  }
  return pick;
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
  /** 🔴 2026-08-25 — query별 다음 페이지 토큰. 예전엔 page.token을 그냥 버렸다.
   *  사장님("야구로 검색해서 야구 리스트를 보면 이후 유튜브가 야구 관련된 걸 트는 거 아냐?") —
   *  기대는 그게 맞지만 **유튜브는 그렇게 동작하지 않는다.** /shorts/<ID>로 직접 연 뒤 스와이프하면
   *  그 영상의 관련 영상이 아니라 계정 기준 **일반 쇼츠 피드**로 이어간다. 그래서 우리 검색 결과
   *  25개가 끝나는 순간 야구와 무관한 게 나온다. → 유튜브에 넘기지 말고 **우리가 다음 페이지를
   *  이어붙인다.** 그 토큰을 쓰려면 버리지 않고 들고 있어야 한다. */
  tokens: Record<string, string | null>;
  resultsLoading: Record<string, boolean>;
  loadPresets: () => Promise<void>;
  search: (query: string) => Promise<void>;
  /** 같은 검색어의 다음 페이지를 이어붙인다. 더 없으면 빈 배열을 준다(호출부가 그때 유튜브로 넘긴다). */
  searchMore: (query: string) => Promise<YouTubeShort[]>;
};

export const useShortsSearchStore = create<ShortsSearchState>((set, get) => ({
  presets: [],
  presetsFetchedAt: 0,
  presetsLoading: false,
  results: {},
  tokens: {},
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
      set((s) => ({
        results: { ...s.results, [query]: page.shorts },
        tokens: { ...s.tokens, [query]: page.nextPageToken ?? null },
      }));
      persistRecentResults(query, page.shorts); // 콜드 스타트 시드용(위 RECENT_RESULTS_KEY 주석)
    } catch {
      set((s) => ({ results: { ...s.results, [query]: s.results[query] ?? [] } }));
    } finally {
      set((s) => ({ resultsLoading: { ...s.resultsLoading, [query]: false } }));
    }
  },

  searchMore: async (query) => {
    const token = get().tokens[query];
    if (!token || get().resultsLoading[query]) return [];
    set((s) => ({ resultsLoading: { ...s.resultsLoading, [query]: true } }));
    try {
      const page = await fetchShortsPage({ query, pageToken: token });
      const known = new Set((get().results[query] ?? []).map((r) => r.videoId));
      const fresh = page.shorts.filter((r) => !known.has(r.videoId)); // 페이지 경계 중복 제거
      set((s) => ({
        results: { ...s.results, [query]: [...(s.results[query] ?? []), ...fresh] },
        tokens: { ...s.tokens, [query]: page.nextPageToken ?? null },
      }));
      return fresh;
    } catch {
      return []; // 네트워크 실패 — 호출부가 유튜브 피드로 넘긴다(막지 않는다)
    } finally {
      set((s) => ({ resultsLoading: { ...s.resultsLoading, [query]: false } }));
    }
  },
}));
