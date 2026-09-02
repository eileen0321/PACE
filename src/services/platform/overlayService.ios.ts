import { requireOptionalNativeModule } from 'expo-modules-core';
import type { OverlayService } from './types';
import { useTimerStore } from '../../store/useTimerStore';

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
  async startSession() {
    // 🔴 2026-09-02 사장님("애플 카메라 렌즈 근처에 계속 PACE 시간재생 알림이 떠 다들 이상하게 봐") —
    //   iOS Live Activity(다이나믹 아일랜드 세션 타이머)를 더 이상 시작하지 않는다. 2026-08-15에
    //   피드 쪽 시작은 이미 뺐는데(그 주석 참고 — iOS는 앱을 벗어나면 세션이 즉시 끝나 LA가 보일
    //   기회 자체가 없다) 홈 세션 시작 경로(home.tsx startSession)에 남아 있어 매 세션마다 떴다.
    //   앱 안에 있는 동안은 상단 "FOCUS ON | Nm" 필로 같은 정보가 이미 보이므로 LA는 순수 잉여다.
    //   시작은 없애고, 혹시 이전에 남은 유령 LA가 있으면 지금 정리한다.
    if (!PaceLiveActivity) return;
    await PaceLiveActivity.endAll().catch(() => {});
  },
  async updateRemaining(remainingMinutes) {
    // 위젯이 스스로 틱하므로 보통 불필요 — 일시정지/연장 등 실제 종료시각이 바뀔 때만 의미 있음.
    if (!PaceLiveActivity) return;
    await PaceLiveActivity.update(remainingMinutes).catch(() => {});
  },
  async endSession() {
    if (!PaceLiveActivity) return;
    await PaceLiveActivity.end().catch(() => {});
    // 2026-08-20 — end()는 모듈이 핸들을 들고 있는 Activity만 끝낸다. 프로세스가 중간에 재시작됐거나
    // 어떤 이유로든 핸들을 잃었으면 조용히 no-op이 되어 유령이 남는다. 정상 종료 경로에서도 한 번 더
    // 전수 정리한다(이미 끝난 것에 대해서는 무해한 no-op).
    await PaceLiveActivity.endAll().catch(() => {});
  },
  // types.ts의 endOrphanedOverlays 주석 참고 — 콜드스타트 시 강제종료로 남은 유령 Live Activity 정리.
  async endOrphanedOverlays() {
    if (!PaceLiveActivity) return;
    await PaceLiveActivity.endAll().catch(() => {});
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
    // ⚠️ 2026-08-06 주석 정정 — 예전 주석은 "iOS는 Screen Time(ManagedSettings Shield)이 자체적으로
    //   차단을 집행"이라고 적혀 있었는데, **Screen Time 차단은 2026-07-26에 전면 삭제됐다**
    //   (types.ts 하단 주석 참고 — entitlement 미승인으로 한 번도 동작한 적 없는 죽은 인프라였다).
    //   즉 iOS에는 "네이티브가 백그라운드에서 스스로 세션을 끝내는" 주체가 아예 없다. 만료 판정과
    //   종료는 전부 JS(overlay/index.tsx의 틱)가 한다 — 그래서 이 1회성 소비 경로가 필요 없어 null이다.
    //   결과는 같지만 이유가 다르다: "다른 게 막아주니까"가 아니라 "JS가 직접 하니까"다.
    //   (이 차이가 중요한 이유: 전자로 읽으면 iOS에도 백그라운드 집행자가 있다고 오해하게 된다.)
    return null;
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
    // 🔴 2026-08-06 크로스플랫폼 감사 — 예전엔 무조건 null이라 호출부가 벽시계로 폴백했고,
    //   그 결과 iOS 통계가 **반쪽**이 됐다:
    //     닫힌 세션 = 실시청 시간(2026-08-06 `3ac55aa`에서 맞춤)
    //     진행 중 세션 = 벽시계 (statsRepository.getTodayUsageMinutes / getWeeklyStats)
    //   같은 "오늘 사용 시간" 숫자 안에서 두 기준이 섞여 있었다 — 안드로이드가 2026-08-03에
    //   없앤 바로 그 모순이 iOS에만 남아 있던 셈.
    // → 이제 JS 틱이 "앱이 활성일 때만" 깎으면서 실제 차감분을 useTimerStore.watchedSeconds에
    //   누적하므로(알약과 정확히 같은 기준) 그 값을 그대로 준다. 호출부는 손댈 필요가 없다
    //   (안드로이드와 같은 계약) — 이것이 이번 감사의 "공통화" 결과다.
    // ⚠️ 세션이 없으면 여전히 null이어야 한다. 콜드스타트 고아 세션 정리(_layout.tsx)는 스토어가
    //   비어 있는 시점에 도는데, 거기서 0을 주면 "0초 봤다"로 잘못 기록된다 — 그 경우는 예전처럼
    //   벽시계로 폴백해야 맞다.
    const s = useTimerStore.getState();
    return s.isSessionActive ? s.watchedSeconds : null;
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
  async setFavoriteAutoChainEnabled() {
    // no-op — iOS는 feed/index.tsx의 forcedListRef로 이미 항상 이어서 재생함
  },
};
