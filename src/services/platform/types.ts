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
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface OverlayService {
  /** Android: 시스템 오버레이 윈도우. iOS: false — Live Activity로 대체. */
  readonly supportsSystemOverlay: boolean;
  startSession(params: { dailyLimitMinutes: number; remainingMinutes: number; autoNext: boolean }): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  endSession(): Promise<void>;
  /** Android: UsageStatsManager 기반 포그라운드 앱 감지 권한(오버레이 자동 표시/숨김에 필요). iOS: 항상 true(no-op). */
  hasForegroundDetectionPermission(): Promise<boolean>;
  requestForegroundDetectionPermission(): Promise<void>;
}

export interface FocusService {
  requestAuthorization(): Promise<boolean>;
  setDailyLimit(minutes: number): Promise<void>;
  isBlocked(): Promise<boolean>;
}
