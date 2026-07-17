import type { AutoNextService } from './types';

// iOS는 다른 앱의 UI/제스처를 조작할 방법이 없어 Auto Next 자체가 불가능(OS 정책 제약).
// supportsAutoNext=false — 상위 UI(설정 화면, 오버레이)는 이 값으로 토글을 숨기거나 비활성 처리한다.
export const autoNextService: AutoNextService = {
  supportsAutoNext: false,
  async start() {
    throw new Error('Auto Next is not supported on iOS');
  },
  async stop() {},
};
