import { getDb } from '../db';
import type { OverlayEventType, SessionEndStatus, ViewingSession } from '../../types/models';

// 세션 CRUD 전용 — 집계/통계 쿼리는 statsRepository.ts로 분리(외부 리뷰 반영: "Store는 DB를 모르고
// Repository만 안다"는 계층 분리 원칙에 따라, Repository 내부도 쓰기(sessions)/읽기집계(stats)로 나눔).
// expo-sqlite 비동기 API(openDatabaseAsync/runAsync/getAllAsync)를 그대로 유지한다 — 2026-07-17 웹 조사
// 결과 Expo 공식 문서가 권장하는 현재 방식이며, sync API(runSync 등)는 메인 스레드 블로킹 위험이 있어
// 무거운 쿼리에는 권장되지 않는다(PACE_ARCHITECTURE.md "외부 리뷰 반영 3차" 참고).
export async function startSession(userId: string, platformApp: string | null): Promise<string> {
  const db = await getDb();
  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    `INSERT INTO viewing_sessions (id, user_id, started_at, duration_seconds, videos_watched, platform_app, status, synced)
     VALUES (?, ?, ?, 0, 0, ?, NULL, 0)`,
    [id, userId, new Date().toISOString(), platformApp]
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

// 2026-07-21 밤 감사 발견 — Settings의 "Export Data" 행이 onPress 자체가 없어 완전히 죽어있었다.
// Privacy 섹션이 "기기 로컬에만 저장됨"을 명시하는 만큼, 그 로컬 데이터를 사용자가 직접 파일로
// 받아볼 수 있어야 문구와 실제 동작이 일치한다 — 세션 이력 전체(동기화 여부 무관, getUnsyncedSessions
// 와 달리 필터 없음)를 내보낸다.
export async function getAllSessionsForExport(userId: string): Promise<ViewingSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM viewing_sessions WHERE user_id = ? ORDER BY started_at DESC`,
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

// 2026-07-20 실기기 감사 중 발견(맥 세션 QA_ISSUES_2026-07-18.md #5) — Settings의 "설정 초기화"가
// "모든 맞춤형 제한 및 카운터 초기화"를 약속하면서 실제로는 logout()만 호출하고 있었다(로컬 게스트라
// 재로그인 시 동일 데이터로 그대로 복귀 — 사실상 아무것도 안 지워짐). 진짜로 사용 기록을 지운다.
export async function clearUserHistory(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM viewing_sessions WHERE user_id = ?`, [userId]);
  await db.runAsync(`DELETE FROM overlay_events WHERE user_id = ?`, [userId]);
}
