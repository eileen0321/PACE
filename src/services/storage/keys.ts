// AsyncStorage 키 중앙 관리. zen-master AuthContext.tsx의 USER_SCOPED_KEYS 패턴을 따른다 —
// 로그아웃/탈퇴 시 지워야 할 키를 여기 한 곳에서 관리해 누락을 방지한다.
export const STORAGE_KEYS = {
  authToken: 'pace_auth_token',
  authUser: 'pace_auth_user',
  deviceId: 'pace_device_id',
  settings: 'pace_user_settings',
  dailyBonus: 'pace_daily_bonus',
  limitHits: 'pace_limit_hits',
  premiumIsPremium: 'pace_premium_is_premium',
  premiumExpiresAt: 'pace_premium_expires_at',
  bluetoothOnboardingSeen: 'pace_bluetooth_onboarding_seen',
  // 2026-07-21 런치 플로우: 온보딩 1회 완료 플래그. index.tsx가 이 값으로 "첫 실행=온보딩 /
  // 이후=바로 세션"을 분기. (Android 커밋 3c2cafb가 참조하면서 키 정의를 빠뜨려 tsc가 깨져 있던 것 보강.)
  onboardingCompleted: 'pace_onboarding_completed',
  // 수면 감지(스펙 §1-B) — 마지막으로 사용자에게 보여준 sleep_detected 세션 id. 홈 화면이 매번
  // getLatestSleepDetectedSession()을 조회하는데, 이 값과 다를 때만 "새벽 X시 Y분에 잠드셨어요"
  // 배너를 새로 띄운다(같은 세션을 앱 재실행마다 반복해서 보여주지 않기 위한 dedupe).
  lastSeenSleepInsightSessionId: 'pace_last_seen_sleep_insight_session_id',
  // 2026-07-23 버그 수정 — BluetoothOnboardingSheet에서 사용자가 고른 Enable/Not Now를 여기 저장한다.
  // 예전엔 이 선택이 "1회성 세션"에만 적용되고 이후 세션부터는 다시 켤 경로가 없어(Focus 탭 토글
  // 버튼이 7/22 UI 단순화로 삭제됨) 핑거스냅/블루투스 핸즈프리가 온보딩 직후 10분 지나면 영구히
  // 죽어 있었다. 이제 이 값을 세션 시작마다(home.tsx startSession) 다시 읽어 Enable을 골랐던
  // 사용자는 매 세션 자동으로 Auto Mode가 켜지게 한다.
  autoModeOptIn: 'pace_auto_mode_opt_in',
} as const;

// 로그아웃 시 회수할 키. 진행도(viewing_sessions/daily_stats)는 SQLite에 있으므로 별도 삭제 로직(database/reset.ts)을 탄다.
export const USER_SCOPED_KEYS: string[] = [
  STORAGE_KEYS.authToken,
  STORAGE_KEYS.authUser,
  STORAGE_KEYS.premiumIsPremium,
  STORAGE_KEYS.premiumExpiresAt,
];
