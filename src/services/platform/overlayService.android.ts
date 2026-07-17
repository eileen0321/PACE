import type { OverlayService } from './types';

// modules/pace-overlay(Expo Modules API 로컬 모듈, PACE_ARCHITECTURE.md "Android Overlay 네이티브 POC"
// 참고)는 npx expo prebuild + EAS Dev Client 빌드가 있어야 링크된다 — Expo Go/일반 JS 번들에서
// requireNativeModule은 즉시 throw하므로 방어적으로 로드(google-signin과 동일 패턴).
let PaceOverlay: {
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): void;
  start(remainingMinutes: number, autoNextEnabled: boolean): Promise<void>;
  updateRemaining(remainingMinutes: number): Promise<void>;
  stop(): Promise<void>;
} | null = null;

try {
  PaceOverlay = require('../../../modules/pace-overlay').PaceOverlay;
} catch (e) {
  console.warn('[overlayService.android] pace-overlay 네이티브 모듈 미링크(Dev Client 빌드 필요) — Overlay 비활성화:', e);
}

// Android 17+ Bubbles API 우선 전략(문서 "최신 플랫폼 트렌드 반영")은 별도 PaceBubbleService로
// 후속 구현 예정 — 현재 네이티브 모듈은 레거시 TYPE_APPLICATION_OVERLAY 경로만 구현돼 있다.
export const overlayService: OverlayService = {
  supportsSystemOverlay: PaceOverlay !== null,

  async startSession({ remainingMinutes, autoNext }) {
    if (!PaceOverlay) return;
    if (!PaceOverlay.hasOverlayPermission()) {
      PaceOverlay.requestOverlayPermission();
      return; // 사용자가 설정에서 권한을 켜고 돌아오면 상위 화면이 재시도해야 함
    }
    await PaceOverlay.start(remainingMinutes, autoNext);
  },

  async updateRemaining(remainingMinutes) {
    await PaceOverlay?.updateRemaining(remainingMinutes);
  },

  async endSession() {
    await PaceOverlay?.stop();
  },
};
