import { Platform } from 'react-native';
import { autoNextService } from './autoNextService';
import { overlayService } from './overlayService';
import { screenTimeService } from './screenTimeService';
import { bluetoothService } from './bluetoothService';

// 외부 리뷰 반영(2026-07-17): 개별 서비스마다 capability 플래그를 흩어두는 대신, 상위 UI가 한 곳만
// 보고 플랫폼 분기를 판단할 수 있도록 단일 AppCapabilities 객체로 묶는다. 각 서비스의 supports* 값을
// 그대로 재수출하므로 값의 진실원천은 여전히 각 서비스(autoNextService/overlayService 등)에 있다.
export type AppCapabilities = {
  supportsAutoNext: boolean;
  supportsSystemOverlay: boolean;
  /** iOS Live Activity/Dynamic Island. Android는 항상 false — Overlay가 그 역할을 대신한다. */
  supportsLiveActivity: boolean;
  supportsAppBlocking: boolean;
  /** iOS Screen Time(FamilyControls)로 실제 숏폼을 차단할 수 있는가. 2026-07-18 iOS 전략 확정. */
  supportsScreenTimeControl: boolean;
  /** Pace Feed(자체 플레이어 대체 피드)를 쓸 수 있는가. iOS의 핵심 대체 경로 — 모든 플랫폼에서 동작 가능. */
  supportsPaceFeed: boolean;
  /**
   * Bluetooth Hands-Free Control UI(Home 배지/Focus 카드/Settings 섹션)를 노출하는가 — 2026-07-19.
   * 두 플랫폼 다 UI는 노출(인앱 버튼 탭은 항상 동작)하고, 실제 하드웨어 리모컨 검증 여부는
   * bluetoothService.supportsHardwareRemote(Android=true 검증완료, iOS=false 미검증)로 별도 구분.
   */
  supportsHandsFreeControl: boolean;
  /** 실제 하드웨어 리모컨(AirPods 등) 신호 수신까지 실기기로 검증됐는가. Android=true, iOS=false(스텁). */
  bluetoothHardwareVerified: boolean;
};

export const capabilities: AppCapabilities = {
  supportsAutoNext: autoNextService.supportsAutoNext,
  supportsSystemOverlay: overlayService.supportsSystemOverlay,
  supportsLiveActivity: !overlayService.supportsSystemOverlay,
  supportsAppBlocking: true, // Android(Accessibility 차단화면)/iOS(FamilyControls) 둘 다 지원
  supportsScreenTimeControl: screenTimeService.supportsScreenTimeControl,
  // Pace Feed는 expo-video 기반이라 플랫폼 무관하게 가능하지만, 제품상 iOS의 "차단 대체 출구"로
  // 우선 노출한다(Android는 오버레이가 실제 피드에 직접 개입하므로 대체 피드 필요성이 낮음).
  supportsPaceFeed: Platform.OS === 'ios',
  supportsHandsFreeControl: true,
  bluetoothHardwareVerified: bluetoothService.supportsHardwareRemote,
};

// 빌드당 고정값이라 Zustand 스토어로 만들 이유는 없지만(런타임에 변하지 않음), 컴포넌트에서
// `const { supportsAutoNext } = useCapabilities()`처럼 훅 스타일로 쓰고 싶을 때를 위한 얇은 래퍼.
export function useCapabilities(): AppCapabilities {
  return capabilities;
}
