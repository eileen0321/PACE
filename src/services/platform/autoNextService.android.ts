import type { AutoNextService } from './types';

// PaceAccessibilityService(Kotlin) 브릿지 — 접근성 권한 확인/요청만 담당(2026-07-20 리디자인).
//
// ⚠️ 2026-07-20 Focus Session 리디자인(PACE_ARCHITECTURE.md 참고): 예전엔 여기서 네이티브의
// "영상 재생 위치를 스스로 감시하다 자율적으로 스와이프"하는 워처를 start()/stop()으로 켜고 껐다 —
// Google Play 정책의 "자율적 판단·실행 자동화 금지" 조항에 걸리는 패턴이라 네이티브 워처 자체를
// 삭제했다(PaceAccessibilityService.kt). 이제 스와이프는 항상 알약 탭/Bluetooth/핑거스냅 같은
// 사용자의 직접 트리거(PaceOverlayModule.triggerSwipe, PaceOverlayService.triggerNext)로만
// 일어난다 — 이 서비스는 그 트리거들이 필요로 하는 접근성 권한 확인/요청 창구로 범위가 좁아졌다.
const ENABLE_AUTO_NEXT = process.env.EXPO_PUBLIC_ENABLE_AUTO_NEXT === 'true';

let PaceOverlay: {
  hasAccessibilityPermission(): boolean;
  requestAccessibilityPermission(): void;
} | null = null;

if (ENABLE_AUTO_NEXT) {
  try {
    PaceOverlay = require('../../../modules/pace-overlay').PaceOverlay;
  } catch (e) {
    console.warn('[autoNextService.android] pace-overlay 네이티브 모듈 미링크(Dev Client 빌드 필요) — Hands-Free 스와이프 비활성화:', e);
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

  // 2026-07-20: 더 이상 아무것도 감시하지 않는다 — Focus Session 리디자인으로 자율 워처 자체가
  // 삭제됐다(위 상단 주석). useAutoNextStore가 세션 시작/종료 시 여전히 이 메서드를 호출하므로
  // 인터페이스는 유지하되 본체는 의도적으로 비워둔다.
  async start() {},
  async stop() {},
};
