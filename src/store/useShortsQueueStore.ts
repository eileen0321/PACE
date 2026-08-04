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
const QUEUE_KEY = 'pace_shorts_queue_v1'; // 큐 영속 — 재실행 시 콜드 네트워크 대기 없이 즉시 첫 영상 재생
const REFILL_THRESHOLD = 3; // 남은 큐가 이 개수 이하가 되면 재fetch
const MAX_WATCHED = 500; // watched 목록 상한(오래된 것부터 버림)
const MAX_CACHED_QUEUE = 20; // 영속하는 큐 상한(용량 절약)

// 큐+토큰을 AsyncStorage에 저장(백그라운드, 실패 무시). advance/refill/loadInitial 성공 시 호출.
function persistQueue(queue: YouTubeShort[], token: string | null) {
  AsyncStorage.setItem(QUEUE_KEY, JSON.stringify({ queue: queue.slice(0, MAX_CACHED_QUEUE), token })).catch(() => {});
}

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

// 2026-08-04 사장님 지적("같은 영상 나오고 사람들 다" — 아이폰으로 확인, "정책만 그럼 둘 다 공통이고
// 주소 다르게 되는 거 아니냐") — 정확한 지적이었고, 여기가 빠져 있었다.
//
// 프록시(/api/youtube-shorts)는 CDN 캐시로 응답을 공유한다 — 그게 "사용자가 100명이든 100만명이든
// YouTube 트래픽 동일"을 만드는 이 설계의 핵심이라 없앨 수 없다. 그런데 앱이 그 목록을 **받은 순서
// 그대로 0번부터** 재생해서, 같은 캐시 창의 사용자는 전원 같은 첫 영상을 봤다.
//
// 해결 원칙은 Android 진입 정책과 같다: **서버는 재료(목록)를, 기기가 순서를 정한다.** 서버가 목록을
// 정하는 한 캐시를 공유하는 사용자끼리 같아지는 건 구조적으로 못 피하지만, 기기에서 섞으면 같은
// 응답을 받아도 각자 다른 영상부터 보게 된다. 서버 캐시 이점은 그대로 유지된다.
//
// Fisher–Yates — 편향 없는 표준 셔플. 매 실행마다 새로 섞이므로 같은 사람이 다시 열어도 순서가 다르다.
function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function dedupeAppend(queue: YouTubeShort[], incoming: YouTubeShort[], watched: string[]): YouTubeShort[] {
  const seen = new Set([...queue.map((s) => s.videoId), ...watched]);
  // 들어온 페이지 안에서만 섞는다 — 이미 재생 중인 앞부분(queue)의 순서를 건드리면 보고 있던 영상이
  // 튀므로, 새로 붙는 부분만 섞어 이어붙인다.
  const fresh = shuffle(incoming.filter((s) => !seen.has(s.videoId)));
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
    // 홈에서 prefetch로 이미 큐가 채워졌거나 로딩 중이면 재fetch 생략(피드 진입 즉시 재생).
    if (get().queue.length > 0 || get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      // 영속된 watched 복원(재실행 시에도 이미 본 Shorts 제외).
      const rawWatched = await AsyncStorage.getItem(WATCHED_KEY).catch(() => null);
      const watchedIds: string[] = rawWatched ? JSON.parse(rawWatched) : [];

      // ⚡ 캐시된 큐 먼저 복원 → 콜드 네트워크 대기 없이 즉시 첫 영상. 그 뒤 백그라운드로 더 받아 append.
      // (이미 본 것은 제외. 캐시가 비었거나 없으면 아래 기존 블로킹 fetch 경로로.)
      try {
        const rawQueue = await AsyncStorage.getItem(QUEUE_KEY);
        const cached = rawQueue ? (JSON.parse(rawQueue) as { queue: YouTubeShort[]; token: string | null }) : null;
        const cachedQueue = (cached?.queue ?? []).filter((s) => !watchedIds.includes(s.videoId));
        if (cachedQueue.length > 0) {
          set({ queue: cachedQueue, watchedIds, nextPageToken: cached?.token ?? null, hasMore: true, isLoading: false });
          get().refill().catch(() => {}); // 백그라운드 보충(실패해도 캐시로 계속 재생)
          return;
        }
      } catch {
        /* 캐시 파싱 실패 → 기존 경로 */
      }

      let page = await fetchShortsPage({});
      let queue = dedupeAppend([], page.shorts, watchedIds);
      let token = page.nextPageToken;
      // hasMore는 nextPageToken이 "실제로 있을 때"만 true — 프록시가 필드를 생략하면 undefined인데,
      // `undefined !== null`은 true라 refill이 page1을 무한 재fetch하던 버그(감사 발견) 방지: !!token.
      let hasMore = !!token;

      // 첫 페이지가 전부 watched로 걸러지면(감사 발견: 피드 영구 공백) EMPTY로 끝내지 말고 다음
      // 페이지로 계속 받아 신선한 Shorts가 나올 때까지 페이지네이션(최대 5페이지 — 무한루프 방지).
      let guard = 0;
      while (queue.length === 0 && hasMore && guard < 5) {
        guard += 1;
        page = await fetchShortsPage({ pageToken: token });
        queue = dedupeAppend([], page.shorts, watchedIds);
        token = page.nextPageToken;
        hasMore = !!token;
      }

      if (queue.length === 0) {
        set({ isLoading: false, error: 'EMPTY_FEED', watchedIds, nextPageToken: token, hasMore });
        return;
      }
      set({ queue, watchedIds, nextPageToken: token, hasMore, isLoading: false });
      persistQueue(queue, token);
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'YT_ERROR' });
    }
  },

  // 현재 영상을 watched+history로 옮기고 다음으로. 큐가 얇아지면 refill 스케줄.
  advance: () => {
    const { queue, watchedIds, history } = get();
    if (queue.length === 0) return;
    const finished = queue[0];
    // Set으로 중복 제거(감사 발견: goToPrevious로 되돌린 영상을 다시 advance하면 watchedIds에 중복
    // 누적돼 MAX_WATCHED 캡이 실질적으로 줄던 문제).
    const nextWatched = Array.from(new Set([...watchedIds, finished.videoId])).slice(-MAX_WATCHED);
    const nextQueue = queue.slice(1); // ← 보여준 건 리스트에서 삭제
    const nextHistory = [...history, finished].slice(-MAX_WATCHED);
    set({ queue: nextQueue, watchedIds: nextWatched, history: nextHistory });
    AsyncStorage.setItem(WATCHED_KEY, JSON.stringify(nextWatched)).catch(() => {});
    persistQueue(nextQueue, get().nextPageToken);
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
      set({ queue: merged, nextPageToken: page.nextPageToken, hasMore: !!page.nextPageToken, isRefilling: false });
      persistQueue(merged, page.nextPageToken);
    } catch {
      set({ isRefilling: false });
    }
  },
}));
