import type { OverlayService } from './types';
import type { SessionEndStatus } from '../../types/models';

// modules/pace-overlay(Expo Modules API 로컬 모듈, PACE_ARCHITECTURE.md "Android Overlay 네이티브 POC"
// 참고)는 npx expo prebuild + EAS Dev Client 빌드가 있어야 링크된다 — Expo Go/일반 JS 번들에서
// requireNativeModule은 즉시 throw하므로 방어적으로 로드(google-signin과 동일 패턴).
let PaceOverlay: {
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): void;
  hasUsageAccessPermission(): boolean;
  requestUsageAccessPermission(): void;
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
    bluetoothVolumeKeySkipEnabled: boolean;
  }): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  stop(): Promise<void>;
  consumeExpired(): { reason: string; sleepOnsetAtMs: number } | null;
  getVideoWatchCount(): number;
  hasBatteryOptimizationExemption(): boolean;
  requestBatteryOptimizationExemption(): void;
  consumeAccessibilityRevoked(): boolean;
} | null = null;

try {
  PaceOverlay = require('../../../modules/pace-overlay').PaceOverlay;
} catch (e) {
  console.warn('[overlayService.android] pace-overlay 네이티브 모듈 미링크(Dev Client 빌드 필요) — Overlay 비활성화:', e);
}

// 감사 MEDIUM5 — consumeExpired()의 동시 호출을 묶는 공유 in-flight promise (아래 consumeExpired 참고).
let pendingConsumeExpired: Promise<{ reason: SessionEndStatus; sleepOnsetAtMs: number | null } | null> | null = null;

async function readNativeExpiry() {
  const result = PaceOverlay?.consumeExpired() ?? null;
  if (!result) return null;
  return {
    reason: result.reason as SessionEndStatus,
    sleepOnsetAtMs: result.sleepOnsetAtMs >= 0 ? result.sleepOnsetAtMs : null,
  };
}

// Android 17+ Bubbles API 우선 전략(문서 "최신 플랫폼 트렌드 반영")은 별도 PaceBubbleService로
// 후속 구현 예정 — 현재 네이티브 모듈은 레거시 TYPE_APPLICATION_OVERLAY 경로만 구현돼 있다.
export const overlayService: OverlayService = {
  supportsSystemOverlay: PaceOverlay !== null,

  async startSession({ remainingMinutes, autoNext, sleepTimerMinutes, breakIntervalMinutes, notifyRemaining, notifyLimit, notifyBreak, hardBlockMode, sleepStillnessMinutes, bluetoothVolumeKeySkipEnabled }) {
    if (!PaceOverlay) return;
    if (!PaceOverlay.hasOverlayPermission()) {
      PaceOverlay.requestOverlayPermission();
      return; // 사용자가 설정에서 권한을 켜고 돌아오면 상위 화면이 재시도해야 함
    }
    // 포그라운드 앱 감지(ForegroundAppWatcher, UsageStatsManager)용 별도 권한 — 없으면 오버레이가
    // 지원 앱(YouTube/Instagram) 여부와 무관하게 항상 표시되는 구버전 동작으로 자동 폴백된다
    // (PaceOverlayService.kt의 startForegroundAppPolling 참고), 세션 자체는 막지 않는다.
    if (!PaceOverlay.hasUsageAccessPermission()) {
      PaceOverlay.requestUsageAccessPermission();
    }
    await PaceOverlay.start({
      remainingMinutes,
      autoNextEnabled: autoNext,
      sleepTimerMinutes,
      breakIntervalMinutes,
      notifyRemaining,
      notifyLimit,
      notifyBreak,
      hardBlockMode,
      sleepStillnessMinutes,
      bluetoothVolumeKeySkipEnabled,
    });
  },

  async updateRemaining(remainingMinutes) {
    await PaceOverlay?.updateRemaining(remainingMinutes);
  },

  async endSession() {
    await PaceOverlay?.stop();
  },

  async hasOverlayPermission() {
    return PaceOverlay?.hasOverlayPermission() ?? false;
  },

  async requestOverlayPermission() {
    PaceOverlay?.requestOverlayPermission();
  },

  async hasForegroundDetectionPermission() {
    return PaceOverlay?.hasUsageAccessPermission() ?? false;
  },

  async requestForegroundDetectionPermission() {
    PaceOverlay?.requestUsageAccessPermission();
  },

  async consumeExpired() {
    // 감사 MEDIUM5(2026-07-27, Mac→Windows 인계) — consumeExpired()는 네이티브 쪽 1회성 소비(consume-once)
    // 읽기라, 같은 AppState 'active' 전이 하나에 반응해 _layout.tsx(콜드스타트 정리/전경 재확인 effect)와
    // overlay/index.tsx(AppState 리스너/unmount 폴백) 총 4곳이 동시에 이걸 부르면 가장 먼저 읽은 곳만
    // 진짜 사유를 받고 나머지는 전부 null을 받아 — sleep_detected 같은 진짜 사유가 사라지고 그중 한
    // 호출부가 폴백으로 manual_stop을 기록하거나 수면 배너 자체가 유실될 수 있었다. 동시에 들어온
    // 호출들을 네이티브를 1번만 실제로 읽는 공유 Promise로 묶어 전부 같은 결과를 받게 한다 — 서로 다른
    // (겹치지 않는) AppState 전이는 그 Promise가 정리된 뒤라 여전히 각자 새로 읽는다.
    if (!pendingConsumeExpired) {
      pendingConsumeExpired = readNativeExpiry().finally(() => {
        pendingConsumeExpired = null;
      });
    }
    return pendingConsumeExpired;
  },

  async getVideoWatchCount() {
    return PaceOverlay?.getVideoWatchCount() ?? 0;
  },

  async hasBatteryOptimizationExemption() {
    return PaceOverlay?.hasBatteryOptimizationExemption() ?? true;
  },

  async requestBatteryOptimizationExemption() {
    PaceOverlay?.requestBatteryOptimizationExemption();
  },

  async consumeAccessibilityRevoked() {
    return PaceOverlay?.consumeAccessibilityRevoked() ?? false;
  },
};
