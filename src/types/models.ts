export type AuthProvider = 'apple' | 'google' | 'guest';

export type User = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  provider: AuthProvider;
  isGuest: boolean;
  createdAt: string;
};

export type SubscriptionPlan = 'free' | 'premium_monthly' | 'premium_yearly';
export type SubscriptionStatus = 'active' | 'expired' | 'none';

export type Subscription = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  expiresAt: string | null;
};

export type AppShieldTarget = 'youtube' | 'instagram' | 'tiktok';

// 외부 리뷰 반영(2026-07-17): "유튜브만 Auto Next, 틱톡은 OFF" 같은 앱별 요구를 지원하기 위해
// 전역 설정과 별개로 앱별 override를 둔다. null = 전역값 상속(기본값).
export type AppSettingsOverride = {
  autoNext: boolean | null;
  dailyLimitMinutes: number | null;
};

export type UserSettings = {
  autoNext: boolean;
  sleepTimerMinutes: number | null;
  dailyLimitMinutes: number;
  breakIntervalMinutes: number;
  /** 세션 시작 전 15초 호흡 유도 화면 — 오버레이 자체와는 별개로, 세션 진입 전 1회성 프리롤. */
  preSessionBreathing: boolean;
  appShields: Record<AppShieldTarget, boolean>;
  /** 앱별 Auto Next/Daily Limit override. 값이 null인 필드는 위 전역 설정을 그대로 따른다. */
  perApp: Record<AppShieldTarget, AppSettingsOverride>;
  theme: 'light' | 'dark' | 'system';
  /** 'system'이면 기기 로케일을 따름(en/ko만 지원, 그 외 언어는 en으로 폴백). */
  language: 'system' | 'en' | 'ko';
};

/** 특정 앱에 적용될 유효 설정 — override가 없으면 전역값으로 폴백. */
export function resolveAppSettings(settings: UserSettings, target: AppShieldTarget): { autoNext: boolean; dailyLimitMinutes: number } {
  const override = settings.perApp[target];
  return {
    autoNext: override?.autoNext ?? settings.autoNext,
    dailyLimitMinutes: override?.dailyLimitMinutes ?? settings.dailyLimitMinutes,
  };
}

export type SessionEndStatus = 'completed' | 'daily_limit_reached' | 'sleep_timer_expired' | 'manual_stop';

export type ViewingSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  videosWatched: number;
  platformApp: string | null;
  status: SessionEndStatus | null;
};

export type OverlayEventType = 'AUTO_NEXT' | 'SESSION_STOP' | 'DAILY_LIMIT' | 'BREAK_REMINDER' | 'SLEEP_TIMER';

export type OverlayEvent = {
  id: string;
  sessionId: string | null;
  eventType: OverlayEventType;
  detail: string | null;
  createdAt: string;
};

export type DailyStats = {
  date: string; // YYYY-MM-DD
  totalMinutes: number;
  totalVideos: number;
  longestSessionSeconds: number;
};
