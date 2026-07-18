import { getToken, settingsApi, statsApi, type SessionSyncItem, type SettingsPayload } from '../api/client';
import { getUnsyncedSessions, markSynced } from '../../database/repositories/sessionsRepository';
import type { UserSettings } from '../../types/models';

// 2026-07-18: statsApi.pushSessions/settingsApi.*는 정의만 돼 있고 앱 어디에서도 호출되지 않는
// 미배선 상태였다(백엔드가 존재해도 프론트가 실제로 부르지 않으면 서버에는 아무 데이터도 안 쌓임).
// 이 모듈이 실제 호출부 — 오프라인/로컬 전용 게스트(useUserStore.loginAsGuest의 폴백 브랜치, 토큰
// 없음)에서는 시도 자체를 스킵해 불필요한 401→자동로그아웃(setUnauthorizedHandler)을 막는다.

// 2026-07-18 로컬 스모크테스트로 확인: jackson-datatype-jsr310의 LocalDateTimeDeserializer는 실제로는
// 'Z' 접미사가 붙은 문자열도 관대하게 받아준다(우려했던 400은 재현 안 됨). 그래도 서버 필드 타입이
// LocalDateTime(타임존 개념 없음)인 이상 'Z'를 붙여 보내는 건 의미상 오해의 소지가 있어, 명시적으로
// 벗겨서 보낸다 — 향후 Jackson/Spring 버전이 엄격해져도 깨지지 않도록 하는 방어적 정규화.
function toLocalDateTimeString(iso: string): string {
  return iso.replace(/Z$/, '');
}

export async function pushUnsyncedSessions(userId: string): Promise<void> {
  const token = await getToken();
  if (!token) return; // 로컬 전용 게스트 — 서버 계정 자체가 없음

  const sessions = await getUnsyncedSessions(userId);
  if (!sessions.length) return;

  const payload: SessionSyncItem[] = sessions.map((s) => ({
    id: s.id,
    platformApp: s.platformApp,
    startedAt: toLocalDateTimeString(s.startedAt),
    endedAt: s.endedAt ? toLocalDateTimeString(s.endedAt) : null,
    durationSeconds: s.durationSeconds,
    videosWatched: s.videosWatched,
    // 로컬 SQLite 스키마(database/schema.ts)가 세션 단위 auto-next 사용 여부를 아직 저장하지 않음 —
    // 알려진 한계. 스키마 마이그레이션 없이는 정확한 값을 알 수 없어 false로 보낸다.
    autoNextUsed: false,
    status: s.status,
  }));

  await statsApi.pushSessions(payload);
  await markSynced(sessions.map((s) => s.id));
}

const SETTINGS_SYNC_FIELDS = [
  'autoNext', 'sleepTimerMinutes', 'dailyLimitMinutes', 'breakIntervalMinutes',
  'preSessionBreathing', 'appShields', 'perApp', 'theme', 'language',
] as const;

export async function pushSettings(settings: UserSettings): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const payload: Partial<SettingsPayload> = {};
  for (const key of SETTINGS_SYNC_FIELDS) (payload as any)[key] = settings[key];
  await settingsApi.updateSettings(payload);
}

export async function pullSettings(): Promise<Partial<UserSettings> | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    return (await settingsApi.getSettings()) as Partial<UserSettings>;
  } catch {
    return null;
  }
}
