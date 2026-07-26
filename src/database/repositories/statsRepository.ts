import { getDb } from '../db';
import type { DailyStats } from '../../types/models';

// 집계 전용 Repository — 쓰기는 sessionsRepository.ts, 이 파일은 읽기/GROUP BY만 담당.
export async function getTodayUsageMinutes(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(duration_seconds) as total FROM viewing_sessions WHERE user_id = ? AND date(started_at, 'localtime') = date('now', 'localtime')`,
    [userId]
  );
  return Math.floor((row?.total ?? 0) / 60);
}

export async function getWeeklyStats(userId: string): Promise<DailyStats[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; total_minutes: number; total_videos: number; longest: number }>(
    `SELECT date(started_at, 'localtime') as date,
            SUM(duration_seconds) / 60 as total_minutes,
            SUM(videos_watched) as total_videos,
            MAX(duration_seconds) as longest
     FROM viewing_sessions
     WHERE user_id = ? AND date(started_at, 'localtime') >= date('now', '-6 days', 'localtime')
     GROUP BY date(started_at, 'localtime')
     ORDER BY date ASC`,
    [userId]
  );
  return rows.map((r) => ({
    date: r.date,
    totalMinutes: r.total_minutes ?? 0,
    totalVideos: r.total_videos ?? 0,
    longestSessionSeconds: r.longest ?? 0,
  }));
}

// 2026-07-18: "지난주 대비 X%" 트렌드 표시를 위한 지난주(오늘로부터 -13일 ~ -7일) 집계 —
// getWeeklyStats()는 이번 주(-6일~오늘)만 봐서 비교 기준이 없었다(gap으로 남아있던 항목).
export async function getPreviousWeekStats(userId: string): Promise<DailyStats[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; total_minutes: number; total_videos: number; longest: number }>(
    `SELECT date(started_at, 'localtime') as date,
            SUM(duration_seconds) / 60 as total_minutes,
            SUM(videos_watched) as total_videos,
            MAX(duration_seconds) as longest
     FROM viewing_sessions
     WHERE user_id = ? AND date(started_at, 'localtime') >= date('now', '-13 days', 'localtime') AND date(started_at, 'localtime') < date('now', '-6 days', 'localtime')
     GROUP BY date(started_at, 'localtime')
     ORDER BY date ASC`,
    [userId]
  );
  return rows.map((r) => ({
    date: r.date,
    totalMinutes: r.total_minutes ?? 0,
    totalVideos: r.total_videos ?? 0,
    longestSessionSeconds: r.longest ?? 0,
  }));
}
