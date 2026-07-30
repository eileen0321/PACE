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
    /**
     * 2026-07-26 사장님 결정(D8, "고급 취침모드") — 무진동 수면감지 임계값(분, 5~20 사이). 무료는
     * 항상 10(고정), 프리미엄만 Settings에서 직접 조절. Android(PaceOverlayService)만 실제로
     * 사용 — iOS는 무시(no-op, 수면감지 자체가 아직 없음).
     */
    sleepStillnessMinutes: number;
    /**
     * 2026-07-27 사용자 지시 — 블루투스 스피커/이어폰을 순수 감상용으로만 쓰는 사용자를 위해,
     * 볼륨키를 다음/이전 영상 넘기기 신호로 쓸지 여부를 별도로 끌 수 있게 한다(카메라 제스처
     * Hands-Free 토글과는 독립적). Android만 실제로 게이팅(PaceAccessibilityService.onKeyEvent).
     * iOS는 무시(no-op) — iOS 쪽 볼륨키 처리는 별도 모듈(PaceVolumeKeyModule)이 자체 관리.
     */
    bluetoothVolumeKeySkipEnabled: boolean;
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
  /**
   * 2026-07-26 — sleep_detected일 때 sleepOnsetAtMs(epoch ms)를 같이 반환한다: 네이티브가 무진동
   * 임계값을 넘겨 "감지한" 시각이 아니라 실제 "마지막으로 움직인" 시각(진짜 잠든 시각에 더 가까움)
   * — 세션 ended_at을 이 값으로 기록해야 수면 인사이트 배너("N시 N분에 잠드셨습니다")가 정확하다.
   * sleep_detected가 아니면 항상 null.
   */
  consumeExpired(): Promise<{ reason: SessionEndStatus; sleepOnsetAtMs: number | null } | null>;
  /**
   * 2026-07-26 사용자 지시("몇 편 봤는지 카운트") — 이번 세션에서 실제로 넘어간 영상 편수(자동넘김
   * 스와이프든 사용자가 직접 손으로 넘긴 것이든 전부 포함, PaceAccessibilityService의 재생위치
   * 신호 기반). Android: 실제 값. iOS: 항상 0(no-op) — 서드파티 앱 내부 재생 상태를 관찰할 방법이
   * 없어 애초에 셀 수 없다(PACE_ARCHITECTURE.md "videos_watched 가짜 데이터" 참고). endSession() 전에
   * 호출해야 한다 — endSession()이 네이티브 카운터를 리셋한다.
   */
  getVideoWatchCount(): Promise<number>;
  /**
   * 2026-07-26 사용자 지시(외부 AI 조언 반영) — 접근성/오버레이/사용정보 접근이 삼성 One UI 배터리
   * 최적화의 1순위 회수 타깃이라(이번 세션 내내 실제로 겪음), "배터리 사용량 최적화 제외"를 받아두면
   * 회수 빈도가 줄어든다. Android만 실제 동작, iOS는 이 개념 자체가 없어 항상 true/no-op.
   */
  hasBatteryOptimizationExemption(): Promise<boolean>;
  requestBatteryOptimizationExemption(): Promise<void>;
  /**
   * 2026-07-26 — 접근성 권한이 이전엔 켜져 있었는데 세션 중(백그라운드 최적화 등으로) 조용히 꺼진
   * 적이 있는지 1회성 소비 확인(읽으면 즉시 리셋). true면 재활성화 안내(notifyAccessibilityNeeded)를
   * 띄운다. Android만 실제 신호, iOS는 항상 false.
   */
  consumeAccessibilityRevoked(): Promise<boolean>;
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
  /**
   * 2026-07-27 사용자 지시("손짓을 마스터랑 독립적으로 켜고 끌 수 있어야지") — 카메라 손짓(hand-wave)
   * 감지를 Focus Session 마스터 토글과 별개로 켜고 끈다. Android: 마스터가 이미 켜져 있으면 즉시
   * PaceHandWaveDetector를 시작/중지(다음 세션까지 안 기다림). iOS: no-op(handsFreeGesture는
   * 순수 JS 설정이라 feed/index.tsx가 직접 읽음, 네이티브 브릿지 불필요).
   */
  setHandsFreeGestureEnabled(enable: boolean): Promise<void>;
  /**
   * 2026-07-27 사용자 실기기 지적("핸즈프리 켰는데 블루투스 여전히 안 됨") — 블루투스 볼륨키 스킵을
   * 이미 도는 세션에 즉시 반영한다(그동안은 세션 시작 시점 값(bluetoothVolumeKeySkipEnabled in
   * startSession)만 있어서 세션 도중 설정을 바꿔도 다음 세션까지 전혀 안 먹혔다). Android만 실제
   * 동작(PaceAccessibilityService의 companion 플래그를 즉시 갱신). iOS는 no-op.
   */
  setBluetoothVolumeKeySkipEnabled(enable: boolean): Promise<void>;
  /**
   * 2026-07-27 사용자 지시("시간이나 다른 것들도 다 적용 안되는거 아냐? 전수 확인해") — 세션 시작
   * 시점 값만 읽던 휴식 간격/알림 3종/Hard Block도 위와 같은 결함이 있었다. 이미 도는 세션에 즉시
   * 반영한다. Android만 실제 동작, iOS는 no-op(이 설정들을 쓰는 네이티브 세션 개념 자체가 없음 —
   * iOS는 이 값들을 feed/index.tsx의 JS tick이 직접 참조).
   */
  updateLiveSessionConfig(config: {
    breakIntervalMinutes: number;
    notifyRemaining: boolean;
    notifyLimit: boolean;
    notifyBreak: boolean;
    hardBlockMode: boolean;
  }): Promise<void>;
  /**
   * 2026-07-28 사장님 결정(리셋형) — 취침 타이머를 이미 도는 세션 중에 바꾸면, 경과시간은 버리고
   * 새 값으로 카운트다운을 처음부터 다시 시작한다(비례조정 아님). dailyLimitMinutes와 달리 "오늘
   * 사용량 대비 재계산"이 필요 없어 updateRemaining과는 별도 경로 — 새 값을 그대로 넘기면 된다.
   * minutes<=0은 끄기. Android만 실제 동작, iOS는 no-op(취침 타이머 네이티브 경로 자체가 없음).
   */
  setSleepTimerMinutes(minutes: number): Promise<void>;
  /** Focus Session 지속 시간(분) — 사용자가 직접 선택(Android만 실제로 native에 반영, iOS는 no-op). */
  setFocusSessionDurationMinutes(minutes: number): Promise<void>;
  getFocusSessionDurationMinutes(): Promise<number>;
  /**
   * 2026-07-27 감사 발견 — 프리미엄→무료 다운그레이드 시 이미 도는 중인 세션의 무진동 수면감지
   * 임계값(sleepStillnessMinutes)을 즉시 무료 기본값으로 되돌린다(focusSessionDurationMinutes와
   * 달리 이건 라이브 값이라 다음 세션까지 안 기다리고 바로 반영됨). Android만 실제 동작, iOS는 no-op.
   */
  setSleepStillnessMinutes(minutes: number): Promise<void>;
  /**
   * 2026-07-26 사용자 지시("무료일땐 10분 고정, 보상광고 보면 늘려줘") — Focus Session이 설정된
   * 시간이 다 돼서(사용자가 직접 끈 게 아니라) 자동으로 꺼졌는지 1회성 소비 확인(읽으면 즉시
   * 리셋) — true면 보상형 광고로 연장 유도 모달을 띄운다. Android만 실제 신호, iOS는 항상 false.
   */
  consumeFocusSessionTimedOut(): Promise<boolean>;
  /** 보상형 광고 시청 완료 후 호출 — Focus Session을 extraMinutes만큼 재개. Android만 실제 동작. */
  extendFocusSession(extraMinutes: number): Promise<void>;
  /**
   * 2026-07-21 밤 감사 발견 — 핑거스냅(PaceSnapDetector)이 모든 Focus Session 시작 경로에 연결돼
   * 있는데 RECORD_AUDIO 런타임 권한을 요청하는 JS 코드가 전무했다. 네이티브는 이미 권한 없으면
   * 조용히 no-op하도록 방어돼 있어(PaceSnapDetector.start()의 hasPermission 체크) 크래시는 안 나지만,
   * 사용자에게 권한을 물어본 적 자체가 없어 대부분의 실기기에서 핑거스냅이 영원히 죽어있었다.
   * Android=실제 시스템 권한 다이얼로그. iOS=no-op(핑거스냅 기능 자체가 없음, 항상 true 반환).
   */
  hasRecordAudioPermission(): Promise<boolean>;
  requestRecordAudioPermission(): Promise<boolean>;
  /**
   * 2026-07-24 손 밀어내기(shoo) Hands-Free Next — 핑거스냅과 같은 이유로 표준 dangerous 런타임
   * 권한 요청이 필요하다. Android=실제 카메라 권한 다이얼로그. iOS=no-op(기능 자체가 없음, 항상 true).
   */
  hasCameraPermission(): Promise<boolean>;
  requestCameraPermission(): Promise<boolean>;
  /**
   * 2026-07-31 오버레이 P 메뉴(Favorite/Capture "현재 추가") — 지금 유튜브 Shorts 화면에 떠 있는
   * 영상의 제목/채널/videoId/url을 최대한 읽어온다. Android=접근성 트리 읽기 + 공유시트 가로채기
   * (PaceAccessibilityService.captureCurrentVideoInfo 참고), iOS=Pace Feed 안에서만 의미 있음(no-op
   * 스텁, 항상 전부 null). 실패해도 절대 reject 안 함 — 항상 (일부 필드가 null일 수 있는) 객체로 resolve.
   */
  captureCurrentVideoInfo(): Promise<{ title: string | null; channel: string | null; videoId: string | null; url: string | null }>;
}

// 2026-07-26 사용자 지시로 iOS Screen Time(FamilyControls) 차단 기능 전면 삭제 — Apple의
// Family Controls entitlement가 승인되지 않아 실제로 한 번도 동작한 적이 없었고(ManagedSettings
// Shield를 적용할 DeviceActivityMonitor Extension 자체가 없었음), 어떤 화면에서도 이 서비스를
// 호출하지 않아 사용자에게 노출된 적도 없었다(죽은 인프라). `modules/pace-screentime` 네이티브
// 모듈과 `screenTimeService.ios.ts`/`.android.ts`도 함께 삭제. iOS의 차단 대체 출구는 Pace Feed로
// 유지된다(capabilities.supportsPaceFeed, 이 서비스와 무관하게 계속 동작).
