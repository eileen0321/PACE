import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';
import { saveSettingsMirror } from '../database/repositories/settingsRepository';
import { pullSettings, pushSettings } from '../services/sync/backendSync';
import { useUserStore } from './useUserStore';
import type { UserSettings } from '../types/models';

// 2026-07-20: Settings의 "설정 초기화" 버튼이 실제 기본값으로 되돌리도록 export(맥 세션 QA
// QA_ISSUES_2026-07-18.md #5 — 이전엔 logout()만 호출하고 아무것도 초기화 안 됐음).
export const DEFAULT_SETTINGS: UserSettings = {
  autoNext: true,
  sleepTimerMinutes: null,
  dailyLimitMinutes: 60,
  breakIntervalMinutes: 20,
  preSessionBreathing: true,
  appShields: { youtube: true, instagram: true, tiktok: false },
  theme: 'system',
  language: 'system',
  notifyRemaining: true,
  notifyLimit: true,
  notifyBreak: true,
  hardBlockMode: false,
  focusSessionDurationMinutes: 10,
};

type SettingsState = {
  settings: UserSettings;
  isLoaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<UserSettings>) => Promise<void>;
  /** 로그인 직후 서버 설정을 당겨와 로컬과 병합(서버에 저장된 값이 있으면 우선) — 새 기기/재설치 복구용. */
  syncFromServer: () => Promise<void>;
};

// AsyncStorage에 쓴 다음, 로그인된 유저가 있으면 SQLite user_settings 미러도 write-through로 갱신한다
// (database/repositories/settingsRepository.ts — 실패해도 로컬 설정 자체엔 영향 없게 fire-and-forget).
function mirrorToSqlite(next: UserSettings) {
  const userId = useUserStore.getState().user?.id;
  if (userId) saveSettingsMirror(userId, next).catch(() => {});
}

// 설정은 기기 로컬 우선(zen-master user_settings와 동일 사상) — 로그인 시 서버 병합은 services/api/client의 settingsApi로 후속 연결.
export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.settings);
      if (raw) {
        const saved = JSON.parse(raw);
        set({ settings: { ...DEFAULT_SETTINGS, ...saved } });
      }
    } finally {
      set({ isLoaded: true });
    }
  },

  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
    mirrorToSqlite(next);
    pushSettings(next).catch(() => {}); // 오프라인/미배포 백엔드에서도 로컬 설정 자체는 영향 없음
  },

  syncFromServer: async () => {
    const remote = await pullSettings();
    if (!remote) return;
    const current = get().settings;
    const next: UserSettings = {
      ...current,
      ...remote,
      appShields: { ...current.appShields, ...(remote.appShields ?? {}) },
    };
    set({ settings: next });
    await AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
  },
}));
