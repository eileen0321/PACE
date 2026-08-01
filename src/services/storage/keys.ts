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
  // 2026-07-23 버그 수정 — BluetoothOnboardingSheet에서 사용자가 고른 Enable/Not Now를 여기 저장한다.
  // 예전엔 이 선택이 "1회성 세션"에만 적용되고 이후 세션부터는 다시 켤 경로가 없어(Focus 탭 토글
  // 버튼이 7/22 UI 단순화로 삭제됨) 핑거스냅/블루투스 핸즈프리가 온보딩 직후 10분 지나면 영구히
  // 죽어 있었다. 이제 이 값을 세션 시작마다(home.tsx startSession) 다시 읽어 Enable을 골랐던
  // 사용자는 매 세션 자동으로 Auto Mode가 켜지게 한다.
  autoModeOptIn: 'pace_auto_mode_opt_in',
  // 2026-07-26 사용자 지시("매일 출석하기") — 하루 1회 앱 실행 시 출석 체크 + 크레딧 지급
  // (useAttendanceStore.ts). 날짜 문자열 배열(최근 이력)과 마지막 출석일, 누적 출석 크레딧을
  // 하나로 묶어 저장 — Flip Mode의 credits(오늘 쉰 시간 기반, 매일 리셋)와 달리 이건 매일 리셋되지
  // 않는 "적립 지갑"이라 별도 스토어로 분리했다.
  attendance: 'pace_attendance',
  // 2026-07-28 밤 감사 — "배터리 사용량 최적화 제외"가 Settings 안쪽 한 줄로만 있어 대부분의 사용자가
  // 아예 발견을 못 한다(실기기로 직접 확인: 몇 시간 테스트해도 whitelist에 안 올라가 있었음). 삼성
  // One UI가 접근성/오버레이/사용정보 접근을 회수하는 1순위 타깃이라는 게 이미 알려진 문제라, Home에
  // 배너로 1회 능동 안내한다. 이 키는 "배너를 보여줬는지"만 기록(허용 여부와 무관) — 매 세션마다
  // 시스템 다이얼로그를 다시 띄우면 사용자 짜증 + Google Play가 이 권한 오남용으로 보는 리스크가 있다.
  batteryOptimizationPromptSeen: 'pace_battery_optimization_prompt_seen',
  // 2026-07-29 — 인사이트 배너를 탭했을 때 "가끔" 보너스 크레딧을 주는 선물상자 연출. 하루에 한 번만
  // 보상 시도(연속으로 계속 눌러서 파밍하는 것 방지) — 오늘 이미 시도했는지 날짜로 기록.
  insightGiftClaimedDate: 'pace_insight_gift_claimed_date',
  // 2026-08-01 사용자 지시("출시전에" 백엔드로 이전) — 홈 배너 문구 풀을 백엔드(/insights)에서 받아
  // 하루 단위로 캐싱. 날짜가 바뀌거나 캐시가 없으면 재요청, 실패 시 이 캐시(또는 없으면 로컬 폴백
  // insightContent.ts)로 계속 동작 — 앱이 오프라인이거나 백엔드가 잠깐 죽어도 배너가 안 죽는다.
  insightBundleCache: 'pace_insight_bundle_cache',
  insightBundleCacheDate: 'pace_insight_bundle_cache_date',
} as const;

// 로그아웃 시 회수할 키. 진행도(viewing_sessions/daily_stats)는 SQLite에 있으므로 별도 삭제 로직(database/reset.ts)을 탄다.
export const USER_SCOPED_KEYS: string[] = [
  STORAGE_KEYS.authToken,
  STORAGE_KEYS.authUser,
  STORAGE_KEYS.premiumIsPremium,
  STORAGE_KEYS.premiumExpiresAt,
  STORAGE_KEYS.attendance,
];
