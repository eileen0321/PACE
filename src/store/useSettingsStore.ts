import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';
import { saveSettingsMirror } from '../database/repositories/settingsRepository';
import { useUserStore } from './useUserStore';
import type { AppShieldTarget, AppSettingsOverride, UserSettings } from '../types/models';

const DEFAULT_SETTINGS: UserSettings = {
  autoNext: true,
  sleepTimerMinutes: null,
  dailyLimitMinutes: 60,
  breakIntervalMinutes: 20,
  preSessionBreathing: true,
  appShields: { youtube: true, instagram: true, tiktok: false },
  perApp: {
    youtube: { autoNext: null, dailyLimitMinutes: null },
    instagram: { autoNext: null, dailyLimitMinutes: null },
    tiktok: { autoNext: null, dailyLimitMinutes: null },
  },
  theme: 'system',
  language: 'system',
};

type SettingsState = {
  settings: UserSettings;
  isLoaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<UserSettings>) => Promise<void>;
  /** 앱별 override 병합 갱신 — perApp 전체를 다시 넘길 필요 없이 한 앱의 필드만 patch. */
  updateAppOverride: (target: AppShieldTarget, patch: Partial<AppSettingsOverride>) => Promise<void>;
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
        set({ settings: { ...DEFAULT_SETTINGS, ...saved, perApp: { ...DEFAULT_SETTINGS.perApp, ...saved.perApp } } });
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
  },

  updateAppOverride: async (target, patch) => {
    const current = get().settings;
    const next: UserSettings = {
      ...current,
      perApp: { ...current.perApp, [target]: { ...current.perApp[target], ...patch } },
    };
    set({ settings: next });
    await AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
    mirrorToSqlite(next);
  },
}));
