import { requireNativeModule } from 'expo-modules-core';
import { getMostRecentSession, markSleepDetected } from '../database/repositories/sessionsRepository';
import { useSettingsStore } from '../store/useSettingsStore';

// iOS 백그라운드 수면 감지(방법 B) — 모션 보조프로세서 활동 이력에서 "최근 세션 구간에 ≥30분 연속 정지
// (=잠듦)"를 찾아 그 시작을 세션의 실제 "잠든 시각"(ended_at)으로 보정한다. _layout(앱 재개 시) + 홈의
// 랜덤 usage-insight 노티 발송 "직전"에 호출해, 노티의 "어제 마지막 시청시각"이 보정된 잠든 시각을 쓰게 한다.
let mod: { queryStationaryOnset(sinceMs: number, minMs: number): Promise<number | null> } | null | undefined;

export async function backfillSleepFromHistory(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  if (mod === undefined) { try { mod = requireNativeModule('PaceSleep'); } catch { mod = null; } }
  if (!mod) return;
  try {
    const recent = await getMostRecentSession(userId);
    if (!recent?.endedAt) return;
    const startedMs = new Date(recent.startedAt).getTime();
    const endedMs = new Date(recent.endedAt).getTime();
    if (Date.now() - endedMs > 24 * 3600 * 1000) return; // 어제 것만 — 오래된 세션 재검사 안 함
    const stillnessMin = useSettingsStore.getState().settings.sleepStillnessMinutes || 10;
    const minStationaryMs = Math.max(stillnessMin * 60_000, 30 * 60_000); // 최소 30분 연속 정지 = 실수면(오탐 방지)
    const onset = await mod.queryStationaryOnset(startedMs, minStationaryMs).catch(() => null);
    if (onset && onset > startedMs && onset < endedMs + 5 * 60_000) {
      await markSleepDetected(recent.id, recent.startedAt, new Date(onset).toISOString());
    }
  } catch { /* 부가 기능 — 실패해도 앱 사용에 지장 없어야 함 */ }
}
