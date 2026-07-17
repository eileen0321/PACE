import { getDb } from '../db';
import type { OverlayEvent, OverlayEventType, SessionEndStatus, ViewingSession } from '../../types/models';

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

export async function endSession(sessionId: string, durationSeconds: number, videosWatched: number, status: SessionEndStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE viewing_sessions SET ended_at = ?, duration_seconds = ?, videos_watched = ?, status = ? WHERE id = ?`,
    [new Date().toISOString(), durationSeconds, videosWatched, status, sessionId]
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

export async function getRecentOverlayEvents(userId: string, limit = 50): Promise<OverlayEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM overlay_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map((r) => ({ id: r.id, sessionId: r.session_id, eventType: r.event_type, detail: r.detail, createdAt: r.created_at }));
}
