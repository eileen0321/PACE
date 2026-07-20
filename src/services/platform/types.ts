// 플랫폼 네이티브 기능의 공통 인터페이스. 상위 코드(features/, app/)는 이 타입만 알고
// Platform.OS를 직접 검사하지 않는다 — 실제 구현은 ./android, ./ios가 담당하고 ./index.ts가 선택한다.
// PACE_ARCHITECTURE.md "구현상 제약" 참고: 실제 네이티브 모듈(Kotlin/Swift)은 별도 작업.

import type { SessionEndStatus } from '../../types/models';

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
  /**
   * 2026-07-19: Daily Limit뿐 아니라 Sleep Timer/Break Reminder/저시간·한도도달 알림까지 전부
   * Android 네이티브(PaceOverlayService)가 자기 완결적으로 담당 — 백그라운드에서도 JS 없이
   * 카운트다운·알림·세션차단이 계속 동작해야 하므로 세션 시작 시점의 값을 전부 함께 넘긴다.
   * sleepTimerMinutes<=0/breakIntervalMinutes<=0은 "꺼짐". iOS는 이 파라미터들을 무시(no-op) —
   * Screen Time이 별도로 차단을 집행하고, 알림은 여전히 JS 타이머(overlay/index.tsx)가 담당.
   */
  startSession(params: {
    dailyLimitMinutes: number;
    remainingMinutes: number;
    autoNext: boolean;
    sleepTimerMinutes: number;
    breakIntervalMinutes: number;
    notifyRemaining: boolean;
    notifyLimit: boolean;
    notifyBreak: boolean;
    /**
     * 2026-07-19 사용자 제품 결정: 한도 도달 시 기본 동작은 전체화면 Overlay 차단(항상 ON) —
     * 이 플래그는 그 위에 추가로 YouTube 자체를 GLOBAL_ACTION_HOME으로 강제 종료할지 여부.
     * 기본 false, Settings의 "Hard Block Mode" 토글로만 사용자가 직접 켠다. iOS는 무시(no-op).
     */
    hardBlockMode: boolean;
  }): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  endSession(): Promise<void>;
  /** Android: "다른 앱 위에 표시"(SYSTEM_ALERT_WINDOW) 권한 실제 부여 상태. iOS: 항상 true(no-op, 개념 자체가 없음). */
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
  /** Android: UsageStatsManager 기반 포그라운드 앱 감지 권한(오버레이 자동 표시/숨김에 필요). iOS: 항상 true(no-op). */
  hasForegroundDetectionPermission(): Promise<boolean>;
  requestForegroundDetectionPermission(): Promise<void>;
  /**
   * Android: 네이티브 카운트다운(PaceOverlayService)이 백그라운드에서 스스로 Daily Limit 또는
   * Sleep Timer 만료로 세션을 차단했는지 확인(1회성 소비, 읽으면 즉시 리셋) — JS setInterval이
   * 백그라운드에서 죽는 문제의 우회책(PACE_ARCHITECTURE.md "백그라운드 타이머 버그" 참고). 만료 안
   * 됐으면 null. iOS: 항상 null(no-op, Screen Time이 자체적으로 차단을 집행하므로 이 경로가 필요 없음).
   */
  consumeExpired(): Promise<SessionEndStatus | null>;
}

export type BluetoothState = {
  isConnected: boolean;
  deviceName: string | null;
  autoModeEnabled: boolean;
  nextCount: number;
  previousCount: number;
  autoToggleCount: number;
};

// 2026-07-19: Bluetooth Hands-Free Control(사용자 지시, Copilot 스펙 정리) — 이어폰 Next/Previous/
// Play-Pause로 숏폼을 조작. Android: 실제 스와이프/Auto Mode 토글/토스트는 전부 네이티브
// MediaSession 콜백(PaceOverlayService.kt)이 자기 완결적으로 처리 — getState()는 표시용 폴링,
// next()/previous()/toggleAutoMode()는 Focus 탭 등 "인앱 버튼 탭"으로 같은 동작을 트리거하는
// 경로(하드웨어 버튼과 별개 입력 소스, 최종 동작은 동일). iOS: 실제 하드웨어 리모컨 이벤트 수신
// (MPRemoteCommandCenter)은 Xcode/실기기가 있어야 작성·검증 가능해 이번 라운드에서 스텁만 있음 —
// next()/previous()/toggleAutoMode()는 useShortsQueueStore를 직접 조작해 화면 버튼 탭까지는 동작.
export interface BluetoothService {
  /** 실제 하드웨어 리모컨 이벤트까지 검증된 상태인가. Android=true(네이티브 구현+검증 완료), iOS=false(스텁, 인앱 버튼만 동작). */
  readonly supportsHardwareRemote: boolean;
  getState(): Promise<BluetoothState>;
  next(): Promise<void>;
  previous(): Promise<void>;
  toggleAutoMode(enable: boolean): Promise<void>;
  /** Focus Session 지속 시간(분) — 사용자가 직접 선택(Android만 실제로 native에 반영, iOS는 no-op). */
  setFocusSessionDurationMinutes(minutes: number): Promise<void>;
  getFocusSessionDurationMinutes(): Promise<number>;
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
