import { create } from 'zustand';
import { capabilities, type AppCapabilities } from '../services/platform';

// capabilities 자체는 빌드당 고정값(services/platform/capabilities.ts)이라 상태 변경 로직은 없다.
// 다른 5개 스토어(useUserStore 등)와 동일한 훅 패턴(`useCapabilityStore()`)으로 쓰고 싶다는
// 외부 리뷰를 반영해 얇은 Zustand 래퍼를 추가 — 컴포넌트 코드 스타일 일관성이 목적.
// non-React 코드(services 등)는 그냥 `capabilities`/`useCapabilities()`를 계속 써도 된다.
export const useCapabilityStore = create<AppCapabilities>(() => capabilities);
