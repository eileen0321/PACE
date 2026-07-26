import { getDb } from '../db';
import type { DailyStats } from '../../types/models';

// 집계 전용 Repository — 쓰기는 sessionsRepository.ts, 이 파일은 읽기/GROUP BY만 담당.
// 감사 LOW/MED6(2026-07-27, Mac→Windows 인계) — 진행 중(ended_at IS NULL)인 세션은 duration_seconds가
// 아직 0이라(끝날 때만 기록됨) 이 합계에서 통째로 빠졌다 — 세션이 도는 동안 Home/Stats가 보여주는
// "오늘 사용량"이 세션이 길어질수록 점점 더 크게 실제보다 낮아지고, 그걸로 계산하는 remainingMinutes도
// 실제보다 커 보였다(사용자 체감상 "돌아올 때마다 일일예산이 리셋되는 것처럼" 보임). 아직 안 닫힌 행은
// started_at~now 실제 경과초를 그 자리에서 계산해 합산한다 — 정상 종료 경로(closeOrphanedSession/
// endSession)와 동일하게 4시간(14400초) 상한을 둬서, 만에 하나 청소가 안 된 채 오래 열려있는 행이 있어도
// 합계가 무한정 커지지 않는다.
export async function getTodayUsageMinutes(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(
       CASE WHEN ended_at IS NULL
         THEN MIN(14400, MAX(0, CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)))
         ELSE duration_seconds
       END
     ) as total
     FROM viewing_sessions WHERE user_id = ? AND date(started_at, 'localtime') = date('now', 'localtime')`,
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
