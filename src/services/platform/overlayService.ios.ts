import { requireOptionalNativeModule } from 'expo-modules-core';
import type { OverlayService } from './types';

// iOS는 다른 앱 위에 항상-표시 윈도우를 띄울 수 없음(OS 정책). 대신 ActivityKit Live Activity +
// Dynamic Island로 "23m Left"를 잠금화면/다이나믹아일랜드에 표시하고, 5분/1분 전은 로컬 알림으로 대체.
// modules/pace-live-activity(ActivityKit 브릿지)를 감싼다. 미링크/구버전(iOS<16.1)에선 graceful no-op.
//
// 남은시간은 "종료 시각(endEpochMs)"으로 넘겨 위젯이 Text(timerInterval:)로 스스로 카운트다운 →
// 앱이 매초 update를 안 쏴도 되고(예산 throttle 회피), 앱이 background/종료돼도 시스템이 틱을 굴린다.
type LiveActivityModule = {
  start(params: { title: string; endEpochMs: number }): Promise<boolean>;
  update(remainingMinutes: number): Promise<boolean>;
  end(): Promise<boolean>;
  endAll(): Promise<boolean>;
};

const PaceLiveActivity = requireOptionalNativeModule<LiveActivityModule>('PaceLiveActivity');

export const overlayService: OverlayService = {
  supportsSystemOverlay: false,
  async startSession({ remainingMinutes }) {
    if (!PaceLiveActivity) return;
    const endEpochMs = Date.now() + Math.max(0, remainingMinutes) * 60_000;
    // 이전 세션이 강제종료 등으로 안 닫혔을 수 있으니 새로 시작 전 정리.
    await PaceLiveActivity.endAll().catch(() => {});
    await PaceLiveActivity.start({ title: 'Focus Session', endEpochMs }).catch(() => {});
  },
  async updateRemaining(remainingMinutes) {
    // 위젯이 스스로 틱하므로 보통 불필요 — 일시정지/연장 등 실제 종료시각이 바뀔 때만 의미 있음.
    if (!PaceLiveActivity) return;
    await PaceLiveActivity.update(remainingMinutes).catch(() => {});
  },
  async endSession() {
    if (!PaceLiveActivity) return;
    await PaceLiveActivity.end().catch(() => {});
  },
  async hasOverlayPermission() {
    return true; // iOS는 시스템 오버레이 개념 자체가 없음(Live Activity로 대체) — no-op
  },
  async requestOverlayPermission() {
    // no-op
  },
  async hasForegroundDetectionPermission() {
    return true; // iOS는 포그라운드 앱 감지 개념 자체가 없음(오버레이 대신 Live Activity/Pace Player) — no-op
  },
  async requestForegroundDetectionPermission() {
    // no-op
  },
  async consumeExpired() {
    return null; // iOS는 Screen Time(ManagedSettings Shield)이 자체적으로 차단을 집행 — no-op
  },
  async getVideoWatchCount() {
    return 0; // iOS는 서드파티 앱 내부 재생 상태를 관찰할 방법이 없어 애초에 셀 수 없음 — no-op
  },
  async getSupportedAppForegroundSecondsToday() {
    // iOS는 다른 앱의 사용 시간을 읽을 수 있는 공개 API가 없다 — Screen Time(DeviceActivityReport)의
    // 데이터는 샌드박스된 확장 밖으로 나올 수 없다는 게 애플의 명시적 설계다. 분석 화면은 null을
    // 받으면 이 섹션 자체를 렌더하지 않는다(Android 전용 기능).
    return null;
  },
  async getWatchedSeconds() {
    // 위와 같은 이유로 iOS는 "실제로 본 시간"을 알 수 없다 — null을 주면 호출부가 기존처럼
    // 벽시계(세션 시작~종료)로 폴백한다. iOS의 정확한 경로는 앱 안의 Pace Feed다.
    return null;
  },
  async hasBatteryOptimizationExemption() {
    return true; // iOS는 이 개념 자체가 없음(Android 전용 배터리 최적화 시스템) — no-op
  },
  async requestBatteryOptimizationExemption() {
    // no-op
  },
  async consumeAccessibilityRevoked() {
    return false; // iOS는 접근성 서비스 개념 자체가 다름(Vision 프레임워크 기반) — no-op
  },

  // iOS는 시스템 오버레이 권한 개념이 없다 — Live Activity가 대신하므로 항상 false.
  async consumeOverlayRevoked() {
    return false;
  },

  // iOS는 이 개념이 없다(Live Activity가 대신) — 항상 살아있는 것으로 취급.
  async isOverlayServiceAlive() {
    return true;
  },
  async hasAccessibilityPermission() {
    return true; // iOS는 이 개념 자체가 없음(Android 전용 AccessibilityService) — no-op
  },
  async requestAccessibilityPermission() {
    // no-op
  },
};
