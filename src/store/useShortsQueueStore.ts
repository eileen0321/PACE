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
  // 2026-07-19: Bluetooth "Previous" 버튼 지원용 — advance()가 큐에서 뺀 영상을 순서대로 쌓아둔다.
  // watchedIds는 dedupe/재등장 방지용 Set 성격이라 순서가 없어 "뒤로 가기"엔 못 씀.
  history: YouTubeShort[];
  watchedIds: string[];
  isLoading: boolean;
  isRefilling: boolean;
  error: string | null;
  nextPageToken: string | null;
  // 2026-07-19: nextPageToken이 null인 상태는 두 가지 경우를 구분 못 한다 — "아직 한 번도 안
  // 받아옴"(초기값)과 "마지막 페이지까지 다 받아서 더 없음"(진짜 고갈). 구분 안 하면 refill()이
  // pageToken:null로 계속 호출 → YouTube API가 "첫 페이지"로 응답해서 무한 루프(1페이지→끝→1페이지
  // 반복)가 된다 — 최소 한 번 fetch가 성공한 뒤에만 hasMore를 판단하도록 별도 플래그로 분리.
  hasMore: boolean;

  current: () => YouTubeShort | null;
  loadInitial: () => Promise<void>;
  advance: () => void;
  // history에서 하나 꺼내 큐 맨 앞으로 되돌린다. history가 비어있으면(세션 시작 직후 등) false.
  goToPrevious: () => boolean;
  refill: () => Promise<void>;
};

function dedupeAppend(queue: YouTubeShort[], incoming: YouTubeShort[], watched: string[]): YouTubeShort[] {
  const seen = new Set([...queue.map((s) => s.videoId), ...watched]);
  const fresh = incoming.filter((s) => !seen.has(s.videoId));
  return [...queue, ...fresh];
}

export const useShortsQueueStore = create<ShortsQueueState>((set, get) => ({
  queue: [],
  history: [],
  watchedIds: [],
  isLoading: false,
  isRefilling: false,
  error: null,
  nextPageToken: null,
  hasMore: true,

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
      set({ queue, watchedIds, nextPageToken: page.nextPageToken, hasMore: page.nextPageToken !== null, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'YT_ERROR' });
    }
  },

  // 현재 영상을 watched+history로 옮기고 다음으로. 큐가 얇아지면 refill 스케줄.
  advance: () => {
    const { queue, watchedIds, history } = get();
    if (queue.length === 0) return;
    const finished = queue[0];
    const nextWatched = [...watchedIds, finished.videoId].slice(-MAX_WATCHED);
    const nextQueue = queue.slice(1); // ← 보여준 건 리스트에서 삭제
    const nextHistory = [...history, finished].slice(-MAX_WATCHED);
    set({ queue: nextQueue, watchedIds: nextWatched, history: nextHistory });
    AsyncStorage.setItem(WATCHED_KEY, JSON.stringify(nextWatched)).catch(() => {});
    if (nextQueue.length <= REFILL_THRESHOLD) {
      get().refill().catch(() => {});
    }
  },

  // Bluetooth Previous — history 맨 뒤(가장 최근 시청)를 큐 맨 앞으로 되돌린다. watchedIds에서는
  // 안 뺀다(다시 "현재" 영상이 될 뿐 재시청 카운트 의미는 유지, refill dedupe에도 계속 걸려야 함).
  goToPrevious: () => {
    const { queue, history } = get();
    if (history.length === 0) return false;
    const prev = history[history.length - 1];
    set({ queue: [prev, ...queue], history: history.slice(0, -1) });
    return true;
  },

  // 다음 페이지를 받아 큐에 append(watched/중복 제외). 동시 호출 방지 + 고갈 시 재호출 방지.
  refill: async () => {
    const { isRefilling, hasMore, nextPageToken, queue, watchedIds } = get();
    if (isRefilling || !hasMore) return;
    set({ isRefilling: true });
    try {
      const page = await fetchShortsPage({ pageToken: nextPageToken });
      const merged = dedupeAppend(queue, page.shorts, watchedIds);
      set({ queue: merged, nextPageToken: page.nextPageToken, hasMore: page.nextPageToken !== null, isRefilling: false });
    } catch {
      set({ isRefilling: false });
    }
  },
}));
