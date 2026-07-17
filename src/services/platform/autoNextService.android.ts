import type { AutoNextService } from './types';

// TODO(네이티브): PaceAccessibilityService(Kotlin) 브릿지 연결.
// 감지 우선순위: 1) MediaSession PlaybackState(STATE_ENDED) 2) Accessibility 이벤트 분석(폴백)
// 감지 후 dispatchGesture()로 3초 카운트 뒤 Swipe Up. 상세는 PACE_ARCHITECTURE.md 참고.
//
// ⚠️ Play 스토어 심사 리스크(외부 리뷰 반영, PACE_ARCHITECTURE.md "외부 리뷰 반영" 섹션 참고):
// AccessibilityService로 "사용자 대신 스와이프"하는 기능은 "접근성 목적이 아닌 남용"으로 리젝될 수 있다.
// 스토어 배포 빌드는 기본 OFF, `EXPO_PUBLIC_ENABLE_AUTO_NEXT=true`로 빌드한 직접 배포(APK)에서만 ON —
// capabilities.ts가 이 플래그를 읽어 상위 UI에 노출 여부를 결정한다.
const ENABLE_AUTO_NEXT = process.env.EXPO_PUBLIC_ENABLE_AUTO_NEXT === 'true';

export const autoNextService: AutoNextService = {
  supportsAutoNext: ENABLE_AUTO_NEXT,
  async start() {
    if (!ENABLE_AUTO_NEXT) throw new Error('Auto Next is disabled in this build (EXPO_PUBLIC_ENABLE_AUTO_NEXT=false)');
    // NativeModules.PaceAutoNext.start() 연결 예정
  },
  async stop() {
    // NativeModules.PaceAutoNext.stop() 연결 예정
  },
};
