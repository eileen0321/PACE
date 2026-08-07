import { requireNativeModule } from 'expo-modules-core';

// Expo Modules API 로컬 모듈 JS 바인딩. Android 전용(expo-module.config.json의 platforms 참고) —
// iOS/web에서 requireNativeModule은 예외를 던지므로 반드시 Platform.OS === 'android'에서만 import할 것
// (services/platform/overlayService.android.ts가 그 경계를 담당).
type PaceOverlayNativeModule = {
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): void;
  hasUsageAccessPermission(): boolean;
  requestUsageAccessPermission(): void;
  // 2026-07-19: Daily Limit뿐 아니라 Sleep Timer/Break Reminder/저시간·한도도달 알림까지 전부
  // 네이티브가 자기 완결적으로 담당 — sleepTimerMinutes<=0은 "꺼짐", breakIntervalMinutes<=0도 "꺼짐".
  start(options: {
    remainingMinutes: number;
    autoNextEnabled: boolean;
    sleepTimerMinutes: number;
    breakIntervalMinutes: number;
    notifyRemaining: boolean;
    notifyLimit: boolean;
    notifyBreak: boolean;
    hardBlockMode: boolean;
    sleepStillnessMinutes: number;
  }): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  stop(): Promise<void>;
  // 네이티브가 백그라운드에서 스스로 카운트다운해 만료되면(Daily Limit 또는 Sleep Timer) 오버레이/
  // 서비스를 직접 정리하고 사유만 남긴다(PaceOverlayService.kt 상단 주석 참고) — JS는 포그라운드
  // 복귀 시 1회 소비. 만료 안 됐으면 null, 만료됐으면 'daily_limit_reached'/'sleep_timer_expired'.
  consumeExpired(): string | null;
  // Auto Next 실제 스와이프(PaceAccessibilityService, 2026-07-18) — Play 스토어 정책 리스크가 있어
  // EXPO_PUBLIC_ENABLE_AUTO_NEXT 빌드에서만 상위 UI/서비스가 이 함수들을 호출한다.
  hasAccessibilityPermission(): boolean;
  requestAccessibilityPermission(): void;
  startAutoNextWatching(intervalMs: number): Promise<void>;
  stopAutoNextWatching(): Promise<void>;
  // Pace Feed(WebView 자체 재생) 전용 MediaSession — useFeedRemoteControl.android.ts 참고.
  startFeedMediaSession(): void;
  stopFeedMediaSession(): void;
  setFeedPlaybackState(playing: boolean): void;
  addListener(
    event: 'onFeedMediaCommand',
    listener: (payload: { action: string }) => void
  ): { remove: () => void };
  // 핑거스냅 Hands-Free Next(2026-07-20, Focus Session 전용) — RECORD_AUDIO는 일반 dangerous 런타임
  // 권한이라 표준 시스템 다이얼로그로 요청한다(hasOverlayPermission류의 "설정 화면" 이동과는 다름).
  hasRecordAudioPermission(): boolean;
  requestRecordAudioPermission(): Promise<{ status: string; granted: boolean }>;
  startSnapDetection(): void;
  stopSnapDetection(): void;
  isSnapDetectionRunning(): boolean;
  // Bluetooth Hands-Free Control(2026-07-19) + Focus Session 지속시간(2026-07-20) — 이 타입에
  // 누락돼 있었다(bluetoothService.android.ts가 자체 로컬 타입으로 대신 선언해 씀). 실제 네이티브
  // 등록은 PaceOverlayModule.kt 참고.
  triggerSwipe(up: boolean): void;
  getBluetoothState(): {
    isConnected: boolean;
    deviceName: string | null;
    autoModeEnabled: boolean;
    nextCount: number;
    previousCount: number;
    autoToggleCount: number;
  };
  setBluetoothAutoMode(enable: boolean): void;
  setFocusSessionDurationMinutes(minutes: number): void;
  getFocusSessionDurationMinutes(): number;
  setSleepStillnessMinutes(minutes: number): void;
  // 2026-07-21 밤 감사 발견 — EXPO_PUBLIC_ENABLE_AUTO_NEXT는 JS 전용이라 알약 탭/블루투스 리모컨
  // (둘 다 네이티브에서 직접 setAutoMode를 부름)을 못 막았다. 앱 부팅 시 1회 호출해 네이티브 쪽
  // 게이트를 실제 값으로 맞춘다(PaceOverlayService.setBuildAutoNextEnabled 참고).
  setBuildAutoNextEnabled(enabled: boolean): void;
  // 2026-08-01 — 이미 실행 중인 세션에서 플랫폼 카드를 다시 탭했을 때 쓰는 재소환 전용 경로.
  // Linking.openURL(딥링크)는 항상 특정 intent-filter 화면으로 새로 내비게이션시켜 PIP 등으로
  // 줄어있던 기존 화면을 복원 못 한다 — getLaunchIntentForPackage+REORDER_TO_FRONT로 런처 아이콘을
  // 다시 탭한 것과 동일하게 기존 태스크를 그 상태 그대로 앞으로 가져온다(constants/supportedApps.ts
  // resumePlatformApp 참고).
  resumeThirdPartyApp(packageName: string): void;
  // 2026-08-07 Favorite 리스트 "이어서 재생" 옵트인 토글(기본 OFF) — 실제 체이닝 로직은 전부
  // 네이티브(PaceOverlayService.showSavedFavoriteList + PaceAccessibilityService.startFavoriteChainWatch)
  // 안에서 끝난다. 이 오버레이는 RN 브릿지가 살아있단 보장이 없는 시점(포그라운드 서비스에서 직접)에
  // 뜨므로(showSavedFavoriteList 상단 주석 참고) JS와 이벤트를 주고받지 않는다 — JS는 설정값만 넘긴다.
  setFavoriteAutoChainEnabled(enable: boolean): void;
};

export const PaceOverlay = requireNativeModule<PaceOverlayNativeModule>('PaceOverlay');
