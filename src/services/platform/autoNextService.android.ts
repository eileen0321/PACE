import type { AutoNextService } from './types';

// PaceAccessibilityService(Kotlin) 브릿지 — 2026-07-18 구현 완료.
// 감지 방식: 감시 대상 앱(SupportedApps.PACKAGES)이 포그라운드인 동안 고정 간격으로
// dispatchGesture() 스와이프-업. 영상 길이를 정밀하게 아는 게 아니라 근사 간격이라 완벽하지 않음 —
// MediaSession 기반 정밀 감지는 알림 리스너 권한이 추가로 필요해 스코프가 커져 후속 과제로 남김.
//
// ⚠️ Play 스토어 심사 리스크(PACE_ARCHITECTURE.md "Android AccessibilityService 최적화 원칙" 참고):
// AccessibilityService로 "사용자 대신 스와이프"하는 기능은 "접근성 목적이 아닌 남용"으로 리젝될 수
// 있다. 2026-07-18 사용자 결정: "구현은 해놓고 출시 전에 정책을 결정" — 코드는 완성해두되, 스토어
// 배포 빌드는 기본 OFF, `EXPO_PUBLIC_ENABLE_AUTO_NEXT=true`로 빌드한 직접 배포(APK)에서만 ON —
// capabilities.ts가 이 플래그를 읽어 상위 UI에 노출 여부를 결정한다.
const ENABLE_AUTO_NEXT = process.env.EXPO_PUBLIC_ENABLE_AUTO_NEXT === 'true';

const SWIPE_INTERVAL_MS = 8_000;

let PaceOverlay: {
  hasAccessibilityPermission(): boolean;
  requestAccessibilityPermission(): void;
  startAutoNextWatching(intervalMs: number): Promise<void>;
  stopAutoNextWatching(): Promise<void>;
} | null = null;

if (ENABLE_AUTO_NEXT) {
  try {
    PaceOverlay = require('../../../modules/pace-overlay').PaceOverlay;
  } catch (e) {
    console.warn('[autoNextService.android] pace-overlay 네이티브 모듈 미링크(Dev Client 빌드 필요) — Auto Next 비활성화:', e);
  }
}

export const autoNextService: AutoNextService = {
  supportsAutoNext: ENABLE_AUTO_NEXT && PaceOverlay !== null,

  async hasPermission() {
    if (!ENABLE_AUTO_NEXT || !PaceOverlay) return false;
    return PaceOverlay.hasAccessibilityPermission();
  },

  async requestPermission() {
    if (!ENABLE_AUTO_NEXT || !PaceOverlay) return;
    PaceOverlay.requestAccessibilityPermission();
  },

  async start() {
    if (!ENABLE_AUTO_NEXT) throw new Error('Auto Next is disabled in this build (EXPO_PUBLIC_ENABLE_AUTO_NEXT=false)');
    if (!PaceOverlay) return;
    if (!PaceOverlay.hasAccessibilityPermission()) {
      PaceOverlay.requestAccessibilityPermission();
      return; // 사용자가 설정에서 권한을 켜고 돌아오면 상위 화면이 재시도해야 함
    }
    await PaceOverlay.startAutoNextWatching(SWIPE_INTERVAL_MS);
  },

  async stop() {
    await PaceOverlay?.stopAutoNextWatching();
  },
};
