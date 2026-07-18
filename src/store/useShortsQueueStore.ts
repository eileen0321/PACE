import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { YouTubeShort } from '../types/models';
import { fetchShortsPage } from '../services/api/youtube';

// iOS Pace Feed = YouTube Shorts "리스트 순차 재생" 큐(2026-07-18 사용자 지시).
// PACE_ARCHITECTURE.md "iOS Pace Feed 재정의" 참고.
//  - 1,2,3 준비 → 1이 끝나면(advance) 1을 watched로 빼고(=리스트에서 삭제) 2 재생
//  - 큐가 부족(<=REFILL_THRESHOLD)하면 nextPageToken으로 다시 받아 append(스케줄 재fetch)
//  - watched는 영속해서 이미 본 Shorts가 재등장하지 않게 함
const WATCHED_KEY = 'pace_watched_shorts';
const REFILL_THRESHOLD = 3; // 남은 큐가 이 개수 이하가 되면 재fetch
const MAX_WATCHED = 500; // watched 목록 상한(오래된 것부터 버림)

type ShortsQueueState = {
  queue: YouTubeShort[];
  watchedIds: string[];
  isLoading: boolean;
  isRefilling: boolean;
  error: string | null;
  nextPageToken: string | null;

  current: () => YouTubeShort | null;
  loadInitial: () => Promise<void>;
  advance: () => void;
  refill: () => Promise<void>;
};

function dedupeAppend(queue: YouTubeShort[], incoming: YouTubeShort[], watched: string[]): YouTubeShort[] {
  const seen = new Set([...queue.map((s) => s.videoId), ...watched]);
  const fresh = incoming.filter((s) => !seen.has(s.videoId));
  return [...queue, ...fresh];
}

export const useShortsQueueStore = create<ShortsQueueState>((set, get) => ({
  queue: [],
  watchedIds: [],
  isLoading: false,
  isRefilling: false,
  error: null,
  nextPageToken: null,

  current: () => get().queue[0] ?? null,

  loadInitial: async () => {
    set({ isLoading: true, error: null });
    try {
      // 영속된 watched 복원(재실행 시에도 이미 본 Shorts 제외).
      const rawWatched = await AsyncStorage.getItem(WATCHED_KEY).catch(() => null);
      const watchedIds: string[] = rawWatched ? JSON.parse(rawWatched) : [];

      const page = await fetchShortsPage({});
      const queue = dedupeAppend([], page.shorts, watchedIds);
      if (queue.length === 0) {
        set({ isLoading: false, error: 'EMPTY_FEED', watchedIds });
        return;
      }
      set({ queue, watchedIds, nextPageToken: page.nextPageToken, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'YT_ERROR' });
    }
  },

  // 현재 영상을 watched로 옮기고 다음으로. 큐가 얇아지면 refill 스케줄.
  advance: () => {
    const { queue, watchedIds } = get();
    if (queue.length === 0) return;
    const finished = queue[0];
    const nextWatched = [...watchedIds, finished.videoId].slice(-MAX_WATCHED);
    const nextQueue = queue.slice(1); // ← 보여준 건 리스트에서 삭제
    set({ queue: nextQueue, watchedIds: nextWatched });
    AsyncStorage.setItem(WATCHED_KEY, JSON.stringify(nextWatched)).catch(() => {});
    if (nextQueue.length <= REFILL_THRESHOLD) {
      get().refill().catch(() => {});
    }
  },

  // 다음 페이지를 받아 큐에 append(watched/중복 제외). 동시 호출 방지.
  refill: async () => {
    const { isRefilling, nextPageToken, queue, watchedIds } = get();
    if (isRefilling) return;
    set({ isRefilling: true });
    try {
      const page = await fetchShortsPage({ pageToken: nextPageToken });
      const merged = dedupeAppend(queue, page.shorts, watchedIds);
      set({ queue: merged, nextPageToken: page.nextPageToken, isRefilling: false });
    } catch {
      set({ isRefilling: false });
    }
  },
}));
