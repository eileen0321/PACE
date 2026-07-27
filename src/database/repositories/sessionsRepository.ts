import { getDb } from '../db';
import type { OverlayEventType, SessionEndStatus, ViewingSession } from '../../types/models';

// 세션 CRUD 전용 — 집계/통계 쿼리는 statsRepository.ts로 분리(외부 리뷰 반영: "Store는 DB를 모르고
// Repository만 안다"는 계층 분리 원칙에 따라, Repository 내부도 쓰기(sessions)/읽기집계(stats)로 나눔).
// expo-sqlite 비동기 API(openDatabaseAsync/runAsync/getAllAsync)를 그대로 유지한다 — 2026-07-17 웹 조사
// 결과 Expo 공식 문서가 권장하는 현재 방식이며, sync API(runSync 등)는 메인 스레드 블로킹 위험이 있어
// 무거운 쿼리에는 권장되지 않는다(PACE_ARCHITECTURE.md "외부 리뷰 반영 3차" 참고).
// 2026-07-27 감사 발견(MEDIUM 4) — startedAtOverride: iOS 피드의 flushWatchTime은 세그먼트가 끝난 뒤
// (이탈/백그라운드/수면감지) 비로소 startSession→endSession을 부르는데, 예전엔 started_at을 호출 시점(now)
// 으로 박아 넣어 (a) sleep_detected는 ended_at(잠든 시각=과거)보다 started_at(감지 시각=나중)이 커지는
// 역전 행이 되고 (b) 자정 넘겨 본 세션(23:40~00:10)이 flush 시점(00:10) 기준으로 "다음날"에 잘못 귀속됐다.
// 실제 세그먼트 시작 시각을 넘겨받아 started_at ≤ ended_at을 항상 만족시키고 날짜 귀속도 바로잡는다.
export async function startSession(userId: string, platformApp: string | null, startedAtOverride?: string): Promise<string> {
  const db = await getDb();
  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    `INSERT INTO viewing_sessions (id, user_id, started_at, duration_seconds, videos_watched, platform_app, status, synced)
     VALUES (?, ?, ?, 0, 0, ?, NULL, 0)`,
    [id, userId, startedAtOverride ?? new Date().toISOString(), platformApp]
  );
  return id;
}

// 2026-07-26 — endedAtOverride: sleep_detected일 때 실제 "마지막으로 움직인 시각"(overlay/index.tsx
// 참고)을 넘겨받아 그대로 기록한다 — 생략하면 기존처럼 호출 시점(now)을 쓴다.
export async function endSession(sessionId: string, durationSeconds: number, videosWatched: number, status: SessionEndStatus, endedAtOverride?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE viewing_sessions SET ended_at = ?, duration_seconds = ?, videos_watched = ?, status = ? WHERE id = ?`,
    [endedAtOverride ?? new Date().toISOString(), durationSeconds, videosWatched, status, sessionId]
  );
}

// iOS 백그라운드 수면 감지(방법 B, 2026-07-28) — 아직 sleep_detected가 아닌 "가장 최근에 끝난 세션" 1건.
// 재개 시 이 세션 구간에 모션 보조프로세서 이력상 장시간 정지가 있으면 markSleepDetected로 보정한다.
export async function getMostRecentSession(userId: string): Promise<ViewingSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM viewing_sessions WHERE user_id = ? AND ended_at IS NOT NULL AND status != 'sleep_detected'
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    videosWatched: row.videos_watched,
    platformApp: row.platform_app,
    status: row.status,
  };
}

// backfill 보정 — 이미 끝난 세션을 "잠든 시각"(sleepOnsetIso)으로 sleep_detected 전환. videos_watched는 보존하고
// duration만 시작~잠든시각으로 재계산(endSession은 videos를 덮어써서 보정엔 부적합해 별도 함수).
export async function markSleepDetected(sessionId: string, startedAtIso: string, sleepOnsetIso: string): Promise<void> {
  const db = await getDb();
  const dur = Math.max(0, Math.round((new Date(sleepOnsetIso).getTime() - new Date(startedAtIso).getTime()) / 1000));
  await db.runAsync(
    `UPDATE viewing_sessions SET status = 'sleep_detected', ended_at = ?, duration_seconds = ? WHERE id = ?`,
    [sleepOnsetIso, dur, sessionId]
  );
}

// 수면 감지(스펙 §1-B "새벽 1시 23분에 잠드셨습니다" 요약)용 — 가장 최근의 sleep_detected 세션 1건.
// 홈 화면이 앱을 열 때마다 이 값을 조회해 아직 안 보여준 것(useSleepInsightStore가 id로 dedupe)이면
// 인사이트 배너로 보여준다.
export async function getLatestSleepDetectedSession(userId: string): Promise<ViewingSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM viewing_sessions WHERE user_id = ? AND status = 'sleep_detected' AND ended_at IS NOT NULL
     ORDER BY ended_at DESC LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    videosWatched: row.videos_watched,
    platformApp: row.platform_app,
    status: row.status,
  };
}

// 2026-07-26 감사 발견(재부팅/강제종료/크래시 예외처리 감사) — overlay/index.tsx의 startSession()/
// endSession() 짝은 React 컴포넌트의 마운트/언마운트 생명주기에 묶여 있어서, 프로세스가 재부팅·
// 강제종료·크래시로 죽으면 unmount cleanup(끝맺음 DB write)이 아예 안 돈다. 그러면 이 세션 행은
// ended_at이 영원히 NULL로 남아 통계/내보내기에서 "유령 행"이 되고, 실제 시청 시간도 조용히
// 유실된다(코드 어디에도 이걸 감지·정리하는 로직이 없었음). 다음 콜드스타트 때 이 함수로 찾아서
// closeOrphanedSession()으로 정리한다(_layout.tsx에서 1회 호출).
export async function getOrphanedSessions(userId: string): Promise<ViewingSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM viewing_sessions WHERE user_id = ? AND ended_at IS NULL`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    videosWatched: r.videos_watched,
    platformApp: r.platform_app,
    status: r.status,
  }));
}

// endSession()과 별개 함수로 둔 이유: endSession()은 "지금 이 프로세스가 방금 끝낸 세션"을 의미상
// 전제하지만(sleep_detected의 endedAtOverride처럼 현재 세션 상태를 아는 호출부가 씀), 이건 "이전
// 프로세스가 놓고 간 세션을 뒤늦게 정리"하는 별개 의미라 구분한다. 실제 SQL 동작은 endSession과 동일.
export async function closeOrphanedSession(sessionId: string, durationSeconds: number, endedAtIso: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE viewing_sessions SET ended_at = ?, duration_seconds = ?, status = 'app_restarted' WHERE id = ?`,
    [endedAtIso, durationSeconds, sessionId]
  );
}

export async function getUnsyncedSessions(userId: string): Promise<ViewingSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM viewing_sessions WHERE user_id = ? AND synced = 0 AND ended_at IS NOT NULL`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    videosWatched: r.videos_watched,
    platformApp: r.platform_app,
    status: r.status,
  }));
}

export async function markSynced(sessionIds: string[]): Promise<void> {
  if (!sessionIds.length) return;
  const db = await getDb();
  const placeholders = sessionIds.map(() => '?').join(',');
  await db.runAsync(`UPDATE viewing_sessions SET synced = 1 WHERE id IN (${placeholders})`, sessionIds);
}

// overlay_events: 네이티브 모듈 연동 전까지는 JS 쪽 시뮬레이터/스토어에서도 호출 가능한 디버그 로그.
export async function logOverlayEvent(userId: string, sessionId: string | null, eventType: OverlayEventType, detail?: string): Promise<void> {
  const db = await getDb();
  const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    `INSERT INTO overlay_events (id, user_id, session_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, sessionId, eventType, detail ?? null, new Date().toISOString()]
  );
}

// 2026-07-20 실기기 감사 중 발견(맥 세션 QA_ISSUES_2026-07-18.md #5) — Settings의 "설정 초기화"가
// "모든 맞춤형 제한 및 카운터 초기화"를 약속하면서 실제로는 logout()만 호출하고 있었다(로컬 게스트라
// 재로그인 시 동일 데이터로 그대로 복귀 — 사실상 아무것도 안 지워짐). 진짜로 사용 기록을 지운다.
export async function clearUserHistory(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM viewing_sessions WHERE user_id = ?`, [userId]);
  await db.runAsync(`DELETE FROM overlay_events WHERE user_id = ?`, [userId]);
}
