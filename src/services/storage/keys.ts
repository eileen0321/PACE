// AsyncStorage 키 중앙 관리. zen-master AuthContext.tsx의 USER_SCOPED_KEYS 패턴을 따른다 —
// 로그아웃/탈퇴 시 지워야 할 키를 여기 한 곳에서 관리해 누락을 방지한다.
export const STORAGE_KEYS = {
  authToken: 'pace_auth_token',
  authUser: 'pace_auth_user',
  deviceId: 'pace_device_id',
  settings: 'pace_user_settings',
  dailyBonus: 'pace_daily_bonus',
  premiumIsPremium: 'pace_premium_is_premium',
  premiumExpiresAt: 'pace_premium_expires_at',
  bluetoothOnboardingSeen: 'pace_bluetooth_onboarding_seen',
} as const;

// 로그아웃 시 회수할 키. 진행도(viewing_sessions/daily_stats)는 SQLite에 있으므로 별도 삭제 로직(database/reset.ts)을 탄다.
export const USER_SCOPED_KEYS: string[] = [
  STORAGE_KEYS.authToken,
  STORAGE_KEYS.authUser,
  STORAGE_KEYS.premiumIsPremium,
  STORAGE_KEYS.premiumExpiresAt,
];
