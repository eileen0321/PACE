import { getDb } from '../db';
import type { AppShieldTarget, DailyStats } from '../../types/models';

// 집계 전용 Repository — 쓰기는 sessionsRepository.ts, 이 파일은 읽기/GROUP BY만 담당.
export async function getTodayUsageMinutes(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(duration_seconds) as total FROM viewing_sessions WHERE user_id = ? AND date(started_at) = date('now', 'localtime')`,
    [userId]
  );
  return Math.floor((row?.total ?? 0) / 60);
}

export async function getTodayVideoStats(userId: string): Promise<{ videosWatched: number; averageDurationSeconds: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ videos: number | null; avgDuration: number | null }>(
    `SELECT SUM(videos_watched) as videos,
            CASE WHEN SUM(videos_watched) > 0 THEN SUM(duration_seconds) / SUM(videos_watched) ELSE 0 END as avgDuration
     FROM viewing_sessions WHERE user_id = ? AND date(started_at) = date('now', 'localtime')`,
    [userId]
  );
  return { videosWatched: row?.videos ?? 0, averageDurationSeconds: Math.round(row?.avgDuration ?? 0) };
}

// 외부 리뷰 반영(2026-07-17): "YouTube 40m / Instagram 10m / TikTok 5m" 형태의 앱별 사용량 분석.
// viewing_sessions.platform_app을 GROUP BY — 네이티브 Auto Next/Usage 모듈이 platform_app을 채우기
// 전까지는 빈 배열을 반환한다.
export async function getTodayUsageByApp(userId: string): Promise<{ app: AppShieldTarget | 'other'; minutes: number }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ platform_app: string | null; minutes: number }>(
    `SELECT platform_app, SUM(duration_seconds) / 60 as minutes
     FROM viewing_sessions
     WHERE user_id = ? AND date(started_at) = date('now', 'localtime') AND platform_app IS NOT NULL
     GROUP BY platform_app`,
    [userId]
  );
  return rows.map((r) => ({ app: (r.platform_app as AppShieldTarget | null) ?? 'other', minutes: r.minutes ?? 0 }));
}

export async function getWeeklyStats(userId: string): Promise<DailyStats[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; total_minutes: number; total_videos: number; longest: number }>(
    `SELECT date(started_at) as date,
            SUM(duration_seconds) / 60 as total_minutes,
            SUM(videos_watched) as total_videos,
            MAX(duration_seconds) as longest
     FROM viewing_sessions
     WHERE user_id = ? AND started_at >= date('now', '-6 days', 'localtime')
     GROUP BY date(started_at)
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
    `SELECT date(started_at) as date,
            SUM(duration_seconds) / 60 as total_minutes,
            SUM(videos_watched) as total_videos,
            MAX(duration_seconds) as longest
     FROM viewing_sessions
     WHERE user_id = ? AND started_at >= date('now', '-13 days', 'localtime') AND started_at < date('now', '-6 days', 'localtime')
     GROUP BY date(started_at)
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

// 외부 리뷰 반영: viewing_sessions.status 기반 — 세션이 왜 끝났는지 분포(정상종료/한도도달/수면타이머/수동중지).
export async function getSessionEndReasons(userId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: string | null; count: number }>(
    `SELECT status, COUNT(*) as count FROM viewing_sessions
     WHERE user_id = ? AND status IS NOT NULL AND started_at >= date('now', '-6 days', 'localtime')
     GROUP BY status`,
    [userId]
  );
  return Object.fromEntries(rows.map((r) => [r.status ?? 'unknown', r.count]));
}
