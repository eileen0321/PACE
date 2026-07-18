// 플랫폼 네이티브 기능의 공통 인터페이스. 상위 코드(features/, app/)는 이 타입만 알고
// Platform.OS를 직접 검사하지 않는다 — 실제 구현은 ./android, ./ios가 담당하고 ./index.ts가 선택한다.
// PACE_ARCHITECTURE.md "구현상 제약" 참고: 실제 네이티브 모듈(Kotlin/Swift)은 별도 작업.

export type AppUsage = {
  appId: string;
  minutes: number;
};

export interface UsageService {
  readonly capability: 'full' | 'unavailable';
  getTodayUsageMinutes(): Promise<number>;
  getAppUsage(): Promise<AppUsage[]>;
}

export interface AutoNextService {
  /** iOS는 항상 false — 상위 UI가 이 값으로 토글 자체를 숨긴다. */
  readonly supportsAutoNext: boolean;
  /** Android: PaceAccessibilityService가 시스템 설정 > 접근성에 활성화돼 있는지. iOS: 항상 true(no-op). */
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface OverlayService {
  /** Android: 시스템 오버레이 윈도우. iOS: false — Live Activity로 대체. */
  readonly supportsSystemOverlay: boolean;
  startSession(params: { dailyLimitMinutes: number; remainingMinutes: number; autoNext: boolean }): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  endSession(): Promise<void>;
  /** Android: "다른 앱 위에 표시"(SYSTEM_ALERT_WINDOW) 권한 실제 부여 상태. iOS: 항상 true(no-op, 개념 자체가 없음). */
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  /** Android: UsageStatsManager 기반 포그라운드 앱 감지 권한(오버레이 자동 표시/숨김에 필요). iOS: 항상 true(no-op). */
  hasForegroundDetectionPermission(): Promise<boolean>;
  requestForegroundDetectionPermission(): Promise<void>;
  /**
   * Android: 네이티브 카운트다운(PaceOverlayService)이 백그라운드에서 스스로 0에 도달해 세션을
   * 차단했는지 확인(1회성 소비, 읽으면 즉시 리셋) — JS setInterval이 백그라운드에서 죽는 문제의
   * 우회책(PACE_ARCHITECTURE.md "백그라운드 타이머 버그" 참고). iOS: 항상 false(no-op, Screen Time이
   * 자체적으로 차단을 집행하므로 이 경로가 필요 없음).
   */
  consumeExpired(): Promise<boolean>;
}

export interface FocusService {
  requestAuthorization(): Promise<boolean>;
  setDailyLimit(minutes: number): Promise<void>;
  isBlocked(): Promise<boolean>;
}

// iOS 전략 확정(2026-07-18, PACE_ARCHITECTURE.md 참고): iOS는 실제 숏폼을 오버레이/자동넘김할 수
// 없으므로 Screen Time(FamilyControls/DeviceActivity/ManagedSettings)으로 "차단"하고, 그 대체 출구로
// Pace Feed(자체 플레이어)를 제시한다. Android는 접근성/오버레이가 그 역할을 대신하므로 no-op.
//
// ⚠️ FamilyActivitySelection(사용자가 고른 앱 집합)은 불투명 토큰이라 JS로 직렬화해 넘길 수 없다 —
// 네이티브가 선택을 저장하고, JS는 "고르게 하라 / 감시 시작하라"는 coarse 명령만 준다.
export interface ScreenTimeService {
  /** iOS만 true. Android는 false — 상위 UI가 이 값으로 Screen Time 설정 항목 자체를 iOS 전용으로 노출. */
  readonly supportsScreenTimeControl: boolean;
  /** FamilyControls AuthorizationCenter.requestAuthorization(.individual). 성공 여부 반환. */
  requestAuthorization(): Promise<boolean>;
  isAuthorized(): Promise<boolean>;
  /** FamilyActivityPicker를 띄워 사용자가 차단할 앱을 고르게 한다(네이티브가 선택을 영속). */
  presentAppPicker(): Promise<void>;
  /** DeviceActivityMonitor 임계값 설정 + 모니터링 스케줄 시작. 초과 시 ManagedSettings Shield 적용. */
  startMonitoring(params: { dailyLimitMinutes: number }): Promise<void>;
  stopMonitoring(): Promise<void>;
  /** 현재 Shield가 걸려(차단) 있는지 — 상위 UI가 "Pace Feed로 대체" 유도에 사용. */
  isShielded(): Promise<boolean>;
}
