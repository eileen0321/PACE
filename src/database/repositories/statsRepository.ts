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

// 외부 리뷰 반영(2026-07-17): "YouTube 40m / Instagram 10m / TikTok 5m" 형태의 앱별 사용량 분석.
// viewing_sessions.platform_app을 GROUP BY — overlay/index.tsx의 startSession()이 실제 platform_app을
// 기록하면서 실사용 데이터로 채워진다(과거엔 항상 null이라 늘 빈 배열이었음, 이제는 아님).
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
