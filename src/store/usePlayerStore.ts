import { create } from 'zustand';
import type { PaceFeedCategory, PaceVideo } from '../types/models';
import { fetchPaceFeed, hasPexelsKey } from '../services/api/pexels';
import { cacheVideos, endPlaylistSession, startPlaylistSession } from '../database/repositories/playlistRepository';
import { DEFAULT_PACE_FEED_CATEGORY } from '../constants/paceFeed';
import { useUserStore } from './useUserStore';

// iOS Pace Feed 플레이어 상태(2026-07-18 iOS 전략 확정 — PACE_ARCHITECTURE.md 참고).
// useAutoNextStore(=실제 숏폼 앱 위 네이티브 자동넘김의 런타임 상태, Android 전용)와는 별개다.
// 이 스토어는 "우리 자체 <Video> 플레이어 안에서의 재생 큐"를 관리한다 — 우리 콘텐츠라 자동넘김이 합법.
type PlayerState = {
  playlist: PaceVideo[];
  index: number;
  isPlaying: boolean;
  /** 영상 종료 시 다음으로 자동 진행할지. 우리 플레이어 안이라 OS 제약 없이 항상 지원. */
  autoNext: boolean;
  isLoading: boolean;
  error: string | null;
  category: PaceFeedCategory;
  usingFallback: boolean; // Pexels 키 없이 DEV 샘플로 도는 중인지
  sessionId: string | null;
  watchedCount: number;

  current: () => PaceVideo | null;
  loadFeed: (category?: PaceFeedCategory) => Promise<void>;
  next: (auto?: boolean) => void;
  prev: () => void;
  setPlaying: (v: boolean) => void;
  toggleAutoNext: () => void;
  endSession: () => Promise<void>;
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  playlist: [],
  index: 0,
  isPlaying: false,
  autoNext: true,
  isLoading: false,
  error: null,
  category: DEFAULT_PACE_FEED_CATEGORY,
  usingFallback: !hasPexelsKey(),
  sessionId: null,
  watchedCount: 0,

  current: () => {
    const { playlist, index } = get();
    return playlist[index] ?? null;
  },

  loadFeed: async (category) => {
    const cat = category ?? get().category;
    set({ isLoading: true, error: null, category: cat });
    try {
      const videos = await fetchPaceFeed({ category: cat });
      if (videos.length === 0) {
        set({ isLoading: false, error: 'EMPTY_FEED' });
        return;
      }
      cacheVideos(videos).catch(() => {});
      // 세션 시작(로그인 유저가 있을 때만 — 게스트도 user.id는 존재).
      const userId = useUserStore.getState().user?.id;
      let sessionId: string | null = get().sessionId;
      if (userId && !sessionId) {
        sessionId = await startPlaylistSession(userId, cat).catch(() => null);
      }
      set({
        playlist: videos,
        index: 0,
        isPlaying: true,
        isLoading: false,
        usingFallback: !hasPexelsKey(),
        sessionId,
        watchedCount: 0,
      });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'FEED_ERROR' });
    }
  },

  next: (auto = false) => {
    const { index, playlist, watchedCount } = get();
    if (playlist.length === 0) return;
    const nextIndex = (index + 1) % playlist.length; // 끝나면 순환(무한 대체 피드)
    set({ index: nextIndex, isPlaying: true, watchedCount: watchedCount + (auto ? 1 : 0) });
  },

  prev: () => {
    const { index, playlist } = get();
    if (playlist.length === 0) return;
    set({ index: (index - 1 + playlist.length) % playlist.length, isPlaying: true });
  },

  setPlaying: (v) => set({ isPlaying: v }),

  toggleAutoNext: () => set((s) => ({ autoNext: !s.autoNext })),

  endSession: async () => {
    const { sessionId, watchedCount } = get();
    if (sessionId) {
      await endPlaylistSession(sessionId, watchedCount).catch(() => {});
    }
    set({ sessionId: null, isPlaying: false });
  },
}));
