import type { AutoNextService } from './types';

// iOS에는 이 게이트가 막을 네이티브 자동 스와이프 엔진 자체가 없다(no-op) — Android쪽
// autoNextService.android.ts의 동명 함수와 짝을 맞추기 위해서만 존재.
export function syncAutoNextBuildFlag(): void {}

// iOS는 다른 앱의 UI/제스처를 조작할 방법이 없어 Auto Next 자체가 불가능(OS 정책 제약).
// supportsAutoNext=false — 상위 UI(설정 화면, 오버레이)는 이 값으로 토글을 숨기거나 비활성 처리한다.
export const autoNextService: AutoNextService = {
  supportsAutoNext: false,
  async hasPermission() {
    return true; // 개념 자체가 없음(no-op)
  },
  async requestPermission() {},
  async start() {
    throw new Error('Focus Session hands-free advancing is not supported on iOS');
  },
  async stop() {},
  // 자동넘김 횟수 제한(무료 30회/보상형 광고 20회 연장) 개념 자체가 Android 전용(PaceAccessibilityService
  // 스와이프 카운트 기반) — iOS는 그 스와이프 엔진이 없으므로 전부 no-op.
  async setUnlimitedAutoNext() {},
  async consumeAutoNextCapReached() {
    return false;
  },
  async extendAutoNextCap() {},
  async getAutoSwipeStatus() {
    return { count: 0, cap: 0 };
  },
};
