import { getDb } from '../db';
import type { UserSettings } from '../../types/models';

// SQLite user_settings 미러 — 진실원천은 AsyncStorage(useSettingsStore)이고, 이 repository는
// "다음에 백엔드가 생기면 그대로 push할 수 있는" write-through 캐시 역할만 한다(현재 read 경로는
// useSettingsStore가 쓰지 않음 — 필요해지면 앱 재설치/기기 이전 시 로컬 복구용으로 연결 가능).
export async function saveSettingsMirror(userId: string, settings: UserSettings): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO user_settings (user_id, auto_next, sleep_timer_min, daily_limit_min, break_interval_min, pre_session_breathing, app_shields_json, per_app_json, theme, language, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       auto_next=excluded.auto_next, sleep_timer_min=excluded.sleep_timer_min, daily_limit_min=excluded.daily_limit_min,
       break_interval_min=excluded.break_interval_min, pre_session_breathing=excluded.pre_session_breathing,
       app_shields_json=excluded.app_shields_json, per_app_json=excluded.per_app_json, theme=excluded.theme,
       language=excluded.language, updated_at=excluded.updated_at`,
    [
      userId,
      settings.autoNext ? 1 : 0,
      settings.sleepTimerMinutes,
      settings.dailyLimitMinutes,
      settings.breakIntervalMinutes,
      settings.preSessionBreathing ? 1 : 0,
      JSON.stringify(settings.appShields),
      JSON.stringify(settings.perApp),
      settings.theme,
      settings.language,
      new Date().toISOString(),
    ]
  );
}

export async function loadSettingsMirror(userId: string): Promise<UserSettings | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>(`SELECT * FROM user_settings WHERE user_id = ?`, [userId]);
  if (!row) return null;
  return {
    autoNext: !!row.auto_next,
    sleepTimerMinutes: row.sleep_timer_min,
    dailyLimitMinutes: row.daily_limit_min,
    breakIntervalMinutes: row.break_interval_min,
    preSessionBreathing: !!row.pre_session_breathing,
    appShields: row.app_shields_json ? JSON.parse(row.app_shields_json) : { youtube: true, instagram: true, tiktok: false },
    perApp: row.per_app_json ? JSON.parse(row.per_app_json) : {
      youtube: { autoNext: null, dailyLimitMinutes: null },
      instagram: { autoNext: null, dailyLimitMinutes: null },
      tiktok: { autoNext: null, dailyLimitMinutes: null },
    },
    theme: row.theme,
    language: row.language ?? 'system',
  };
}
