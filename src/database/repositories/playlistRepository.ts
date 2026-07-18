import { getDb } from '../db';
import type { PaceFeedCategory, PaceVideo, PlaylistSession } from '../../types/models';

// Pace Feed(iOS 대체 피드) 전용 repository — viewing_sessions(실제 숏폼 앱 세션)와 분리.
// sessionsRepository와 동일하게 expo-sqlite 비동기 API를 쓴다.

export async function startPlaylistSession(userId: string, category: PaceFeedCategory | null): Promise<string> {
  const db = await getDb();
  const id = `play-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    `INSERT INTO playlist_sessions (id, user_id, started_at, videos_watched, category, synced)
     VALUES (?, ?, ?, 0, ?, 0)`,
    [id, userId, new Date().toISOString(), category]
  );
  return id;
}

export async function endPlaylistSession(sessionId: string, videosWatched: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE playlist_sessions SET ended_at = ?, videos_watched = ? WHERE id = ?`,
    [new Date().toISOString(), videosWatched, sessionId]
  );
}

export async function getUnsyncedPlaylistSessions(userId: string): Promise<PlaylistSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM playlist_sessions WHERE user_id = ? AND synced = 0 AND ended_at IS NOT NULL`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    videosWatched: r.videos_watched,
    category: r.category,
  }));
}

// 피드 로컬 캐시(write-through) — 원격 API가 진실원천, 재방문 시 즉시 표시/통계 조인용.
export async function cacheVideos(videos: PaceVideo[]): Promise<void> {
  if (!videos.length) return;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const v of videos) {
      await db.runAsync(
        `INSERT OR REPLACE INTO pace_videos
           (id, title, creator, duration_seconds, url, thumbnail_url, category, source, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, v.title, v.creator, v.durationSeconds, v.url, v.thumbnailUrl, v.category, v.source, now]
      );
    }
  });
}
