import { getDb } from '../db';
// 2026-08-03 — 진행 중인 세션의 "실제 재생 중이었던 시간"은 DB가 아니라 네이티브만 아는 값이라
// (getTodayUsageMinutes 주석 참고) 집계 전용 Repository이지만 예외적으로 플랫폼 서비스를 참조한다.
// 대안(모든 호출부가 값을 인자로 넘기기)은 호출부 4곳 중 하나만 빠뜨려도 조용히 옛 기준으로
// 되돌아가므로, 계산을 한 곳에 모으는 쪽이 더 안전하다고 판단.
import { overlayService } from '../../services/platform';
import type { DailyStats } from '../../types/models';
import type { AppShieldTarget } from '../../types/models';

// 집계 전용 Repository — 쓰기는 sessionsRepository.ts, 이 파일은 읽기/GROUP BY만 담당.
// 감사 LOW/MED6(2026-07-27, Mac→Windows 인계) — 진행 중(ended_at IS NULL)인 세션은 duration_seconds가
// 아직 0이라(끝날 때만 기록됨) 이 합계에서 통째로 빠졌다 — 세션이 도는 동안 Home/Stats가 보여주는
// "오늘 사용량"이 세션이 길어질수록 점점 더 크게 실제보다 낮아지고, 그걸로 계산하는 remainingMinutes도
// 실제보다 커 보였다(사용자 체감상 "돌아올 때마다 일일예산이 리셋되는 것처럼" 보임). 아직 안 닫힌 행은
// started_at~now 실제 경과초를 그 자리에서 계산해 합산한다 — 정상 종료 경로(closeOrphanedSession/
// endSession)와 동일하게 4시간(14400초) 상한을 둬서, 만에 하나 청소가 안 된 채 오래 열려있는 행이 있어도
// 합계가 무한정 커지지 않는다.
// 2026-07-28 사장님 지시("몇시에 잠들었습니다 말고 다른 노티도 — 어제 몇시까지 봤다, 오늘 평균보다
// 얼마 더/덜 봤다") — 재미있는 랜덤 사용 인사이트 알림용 원본 데이터. 어제 마지막 시청 종료시각,
// 어제 총 사용량, 오늘 지금까지 사용량, 오늘을 뺀 최근 7일 평균을 한 번에 모아 반환한다
// (usageInsight.ts가 이 값들로 어떤 템플릿이 "적용 가능한지" 판단).
export type UsageInsightRaw = {
  yesterdayLastWatchedIso: string | null;
  yesterdayTotalMinutes: number;
  avgMinutesExcludingToday: number | null;
};

export async function getUsageInsightData(userId: string): Promise<UsageInsightRaw> {
  const db = await getDb();
  const yesterday = await db.getFirstAsync<{ lastEnded: string | null; total: number | null }>(
    `SELECT MAX(ended_at) as lastEnded, SUM(duration_seconds) as total
     FROM viewing_sessions
     WHERE user_id = ? AND ended_at IS NOT NULL AND date(started_at, 'localtime') = date('now', '-1 day', 'localtime')`,
    [userId]
  );
  const avgRow = await db.getFirstAsync<{ avgMinutes: number | null }>(
    `SELECT AVG(dayTotal) as avgMinutes FROM (
       SELECT SUM(duration_seconds) / 60.0 as dayTotal
       FROM viewing_sessions
       WHERE user_id = ? AND ended_at IS NOT NULL
         AND date(started_at, 'localtime') >= date('now', '-7 days', 'localtime')
         AND date(started_at, 'localtime') < date('now', 'localtime')
       GROUP BY date(started_at, 'localtime')
     )`,
    [userId]
  );
  return {
    yesterdayLastWatchedIso: yesterday?.lastEnded ?? null,
    yesterdayTotalMinutes: Math.floor((yesterday?.total ?? 0) / 60),
    avgMinutesExcludingToday: avgRow?.avgMinutes ?? null,
  };
}

// 2026-08-03 사장님 결정("알약 기준이 맞지 않아?") — 이 함수는 아직 안 끝난 오늘 세션을
// "시작~현재의 벽시계"로 계산했는데, 오버레이 알약의 남은 시간은 실제 재생 중일 때만 깎인다
// (PaceOverlayService.performTick의 isLikelyPlaying 가드). 그래서 세션만 켜두고 30분을 안 보면
// 알약은 그대로인데 이 통계엔 30분이 쌓이는, 같은 "사용 시간"의 두 숫자가 어긋나는 문제가 있었다.
// 사용자가 이해하는 사용 시간은 실제로 본 시간이므로 알약 기준으로 통일한다.
//
// 진행 중인 세션의 실시청 시간은 SQL로 알 수 없다(네이티브만 아는 값) — 그래서 열린 행은 SQL
// 집계에서 빼고, 네이티브가 누적한 값을 밖에서 더한다. iOS는 서드파티 앱의 재생 상태를 관찰할
// 수단이 OS 차원에 없어 null을 주므로, 그 경우엔 기존과 동일하게 벽시계로 폴백한다(회귀 없음).
//
// ⚠️ 이미 닫힌 행(duration_seconds)은 그대로 쓴다. 오늘 이전에 기록된 행들은 벽시계 기준이라
//    과거 데이터의 의미가 소급해서 바뀌지는 않는다 — 이 변경 이후 세션부터 실시청 기준이 된다.
/**
 * 오늘 사용시간을 **앱별로** 나눈 값(분).
 *
 * 2026-07-26에 "앱이 YouTube만 지원"이라며 이 함수와 Stats의 Platform Breakdown 섹션을 통째로
 * 지웠는데(c0cb9b6), 2026-08-12 틱톡이 들어오면서 다시 필요해졌다 — 사장님 지시
 * ("틱톡을 봤으면 같이 나와야 하잖아"). 원본 쿼리를 그대로 되살리되 두 가지를 고쳤다:
 *
 *  1. **진행 중인 세션을 포함한다.** 원본은 닫힌 세션만 더해서, 세션이 도는 동안 이 합계가
 *     getTodayUsageMinutes(진행 중 세션 포함)와 어긋난다. 같은 화면 안에서 숫자가 갈리는
 *     사고는 이미 2026-08-04에 한 번 겪었다(이 파일 아래 getWeeklyStats 주석 참고) — 반복 금지.
 *     열린 세션의 경과시간은 **그 세션의 앱**에만 더한다.
 *  2. 초 단위를 함께 돌려준다. 분으로 나누는 건 화면이 하고, 여기서는 정보를 잃지 않는다
 *     (SUM/60 정수나눗셈이라 30초짜리 세션이 조용히 0분으로 사라지던 문제도 같이 없어진다).
 *
 * 안 본 앱은 행 자체가 없으므로 결과에 안 나온다 — 호출부에서 따로 걸러낼 필요가 없다.
 */
export async function getTodayUsageByApp(userId: string): Promise<{ app: AppShieldTarget | 'other'; minutes: number; seconds: number }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ platform_app: string | null; closed: number | null }>(
    `SELECT platform_app, SUM(CASE WHEN ended_at IS NOT NULL THEN duration_seconds ELSE 0 END) as closed
       FROM viewing_sessions
      WHERE user_id = ? AND date(started_at, 'localtime') = date('now', 'localtime')
        AND platform_app IS NOT NULL
      GROUP BY platform_app`,
    [userId]
  );
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.platform_app ?? 'other', r.closed ?? 0);

  // 열린 세션(오늘, 아직 안 끝난 것) — getTodayUsageMinutes와 동일한 규칙(실시청초, 4시간 상한).
  const open = await db.getFirstAsync<{ platform_app: string | null; started_at: string }>(
    `SELECT platform_app, started_at FROM viewing_sessions
      WHERE user_id = ? AND ended_at IS NULL AND date(started_at, 'localtime') = date('now', 'localtime')
      ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
  if (open?.started_at) {
    const wallClock = Math.min(14400, Math.max(0, Math.round((Date.now() - new Date(open.started_at).getTime()) / 1000)));
    const watched = await overlayService.getWatchedSeconds().catch(() => null);
    const elapsed = watched != null ? Math.min(wallClock, Math.max(0, watched)) : wallClock;
    const key = open.platform_app ?? 'other';
    totals.set(key, (totals.get(key) ?? 0) + elapsed);
  }

  return [...totals.entries()]
    .map(([app, seconds]) => ({ app: app as AppShieldTarget | 'other', minutes: Math.floor(seconds / 60), seconds }))
    .filter((e) => e.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

export async function getTodayUsageMinutes(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ closed: number | null; openStartedAt: string | null }>(
    `SELECT
       SUM(CASE WHEN ended_at IS NOT NULL THEN duration_seconds ELSE 0 END) as closed,
       MAX(CASE WHEN ended_at IS NULL THEN started_at ELSE NULL END) as openStartedAt
     FROM viewing_sessions WHERE user_id = ? AND date(started_at, 'localtime') = date('now', 'localtime')`,
    [userId]
  );
  let total = row?.closed ?? 0;
  if (row?.openStartedAt) {
    // 벽시계 상한(기존과 동일한 4시간 캡 포함) — 네이티브 값이 없거나 비정상적으로 클 때의 폴백.
    const wallClock = Math.min(
      14400,
      Math.max(0, Math.round((Date.now() - new Date(row.openStartedAt).getTime()) / 1000))
    );
    const watched = await overlayService.getWatchedSeconds().catch(() => null);
    total += watched != null ? Math.min(wallClock, Math.max(0, watched)) : wallClock;
  }
  return Math.floor(total / 60);
}

// 감사 LOW/MED6와 동일한 결함 — Stats 탭 "이번 주 시청"/요일별 그래프도 getWeeklyStats() 하나로
// 이번 주 총합을 내는데, 여기도 duration_seconds만 더해 진행 중인 세션의 실제 경과시간이 빠져
// 있었다(오늘 항목만 영향, 지난 날짜엔 열린 행이 있을 수 없음). getTodayUsageMinutes와 동일한
// 경과초 계산 + 4시간 상한을 여기도 적용해 "이번 주" 합계와 "최장 연속 시청"이 진행 중에도 정확하게.
// 2026-08-04 — getTodayUsageMinutes를 실시청 기준으로 바꾸면서 이 함수를 같이 안 고쳐서, 분석 화면
// 안에서 자가 다시 갈려 있었다: "기록 범위 → Pace가 기록한 시간"은 실시청인데, 같은 화면의
// "This Week" 히어로·주간 그래프·"Longest Session"은 이 함수를 쓰므로 진행 중인 세션이 여전히
// 벽시계로 잡혔다 — 사장님이 지적하신 바로 그 모순을 한쪽만 없앤 꼴이었다. 두 함수의 기준을 맞춘다.
export async function getWeeklyStats(userId: string): Promise<DailyStats[]> {
  const db = await getDb();
  // 진행 중(ended_at IS NULL)인 행은 SQL 집계에서 빼고 아래에서 실시청 시간으로 따로 더한다
  // (실시청 시간은 DB가 아니라 네이티브만 아는 값 — getTodayUsageMinutes와 동일한 구조).
  const rows = await db.getAllAsync<{ date: string; total_minutes: number; total_videos: number; longest: number }>(
    `SELECT date(started_at, 'localtime') as date,
            SUM(CASE WHEN ended_at IS NOT NULL THEN duration_seconds ELSE 0 END) / 60 as total_minutes,
            SUM(videos_watched) as total_videos,
            MAX(CASE WHEN ended_at IS NOT NULL THEN duration_seconds ELSE 0 END) as longest
     FROM viewing_sessions
     WHERE user_id = ? AND date(started_at, 'localtime') >= date('now', '-6 days', 'localtime')
     GROUP BY date(started_at, 'localtime')
     ORDER BY date ASC`,
    [userId]
  );
  const stats: DailyStats[] = rows.map((r) => ({
    date: r.date,
    totalMinutes: r.total_minutes ?? 0,
    totalVideos: r.total_videos ?? 0,
    longestSessionSeconds: r.longest ?? 0,
  }));

  const open = await db.getFirstAsync<{ date: string; startedAt: string }>(
    `SELECT date(started_at, 'localtime') as date, started_at as startedAt
     FROM viewing_sessions
     WHERE user_id = ? AND ended_at IS NULL AND date(started_at, 'localtime') >= date('now', '-6 days', 'localtime')
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
  if (open) {
    const wallClock = Math.min(
      14400,
      Math.max(0, Math.round((Date.now() - new Date(open.startedAt).getTime()) / 1000))
    );
    // iOS는 null → 기존과 동일하게 벽시계(회귀 없음). Android는 실시청 시간, 벽시계를 상한으로.
    const watched = await overlayService.getWatchedSeconds().catch(() => null);
    const seconds = watched != null ? Math.min(wallClock, Math.max(0, watched)) : wallClock;
    const entry = stats.find((s) => s.date === open.date);
    if (entry) {
      entry.totalMinutes += Math.floor(seconds / 60);
      entry.longestSessionSeconds = Math.max(entry.longestSessionSeconds, seconds);
    } else {
      // 오늘 닫힌 세션이 하나도 없어 그 날짜 행 자체가 없는 경우 — 진행 중인 세션만으로 행을 만든다
      // (예전 SQL은 open 행도 GROUP BY에 포함했으므로 이 행이 있었다. 빠뜨리면 회귀가 된다).
      stats.push({ date: open.date, totalMinutes: Math.floor(seconds / 60), totalVideos: 0, longestSessionSeconds: seconds });
      stats.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return stats;
}

// 2026-07-18: "지난주 대비 X%" 트렌드 표시를 위한 지난주(오늘로부터 -13일 ~ -7일) 집계 —
// getWeeklyStats()는 이번 주(-6일~오늘)만 봐서 비교 기준이 없었다(gap으로 남아있던 항목).
export async function getPreviousWeekStats(userId: string): Promise<DailyStats[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ date: string; total_minutes: number; total_videos: number; longest: number }>(
    // 🔴 2026-08-13 발견 6 — 이 함수만 열린 행(ended_at IS NULL)을 안 걸러서, 집계 4함수 중
    //   혼자 규칙이 달랐다(getTodayUsageMinutes/getTodayUsageByApp/getWeeklyStats는 전부
    //   `CASE WHEN ended_at IS NOT NULL`). 지난주 구간엔 열린 행이 있을 수 없고 있어도
    //   duration_seconds가 0이라 **결과는 같았지만**, 규칙이 갈려 있는 상태 자체가 이 파일이
    //   2026-08-04에 겪은 사고("같은 화면 안에서 숫자가 갈림")의 재료다. 형태를 맞춰 둔다.
    `SELECT date(started_at, 'localtime') as date,
            SUM(CASE WHEN ended_at IS NOT NULL THEN duration_seconds ELSE 0 END) / 60 as total_minutes,
            SUM(videos_watched) as total_videos,
            MAX(CASE WHEN ended_at IS NOT NULL THEN duration_seconds ELSE 0 END) as longest
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
