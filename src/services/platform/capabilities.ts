import { autoNextService } from './autoNextService';
import { overlayService } from './overlayService';

// 외부 리뷰 반영(2026-07-17): 개별 서비스마다 capability 플래그를 흩어두는 대신, 상위 UI가 한 곳만
// 보고 플랫폼 분기를 판단할 수 있도록 단일 AppCapabilities 객체로 묶는다. 각 서비스의 supports* 값을
// 그대로 재수출하므로 값의 진실원천은 여전히 각 서비스(autoNextService/overlayService 등)에 있다.
export type AppCapabilities = {
  supportsAutoNext: boolean;
  supportsSystemOverlay: boolean;
  /** iOS Live Activity/Dynamic Island. Android는 항상 false — Overlay가 그 역할을 대신한다. */
  supportsLiveActivity: boolean;
  supportsAppBlocking: boolean;
};

export const capabilities: AppCapabilities = {
  supportsAutoNext: autoNextService.supportsAutoNext,
  supportsSystemOverlay: overlayService.supportsSystemOverlay,
  supportsLiveActivity: !overlayService.supportsSystemOverlay,
  supportsAppBlocking: true, // Android(Accessibility 차단화면)/iOS(FamilyControls) 둘 다 지원
};

// 빌드당 고정값이라 Zustand 스토어로 만들 이유는 없지만(런타임에 변하지 않음), 컴포넌트에서
// `const { supportsAutoNext } = useCapabilities()`처럼 훅 스타일로 쓰고 싶을 때를 위한 얇은 래퍼.
export function useCapabilities(): AppCapabilities {
  return capabilities;
}
