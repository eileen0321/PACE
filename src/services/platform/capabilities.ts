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
   * "Bluetooth 헤드셋의 하드웨어 버튼으로 YouTube Shorts를 직접 조작"한다는 원래 약속을 보여주는
   * UI(Home 배지/칩, Settings "Playback Controls", Stats "Bluetooth Controls")를 노출하는가.
   * 2026-07-25 B1 정정 — Android는 이 하드웨어 버튼 라우팅이 OS 레벨에서 100% 불가능함이 두 차례
   * 실기기 검증(2026-07-19·07-23, QA_ANDROID_LIFECYCLE_2026-07-22.md #B22)으로 확정됐고, 유일한
   * 인앱 대체 진입점(Next/Prev 버튼)도 이미 삭제돼(#B26) 이 문구가 약속하는 내용은 Android에서
   * 도달 불가능한 죽은 기능이다 — false로 내려 UI에서 숨긴다.
   * ⚠️ 주의: `useBluetoothStore.toggleAutoMode`/`enableAutoModeForSession`(핑거스냅·손 밀어내기·
   * 위치 감시 기반 "Auto Mode"/Focus Session)는 **이 플래그와 별개의 실제 동작하는 Android 전용
   * 기능**이다(PACE_ARCHITECTURE.md "Focus Session 리디자인" 참고) — 이 플래그를 false로 내려도
   * BluetoothOnboardingSheet의 Enable 진입점과 Auto Mode 토글 자체는 그대로 남겨뒀다(Android에서
   * 지금도 실제로 쓰이는 기능이라 끄면 안 됨). iOS는 이 값이 그대로 true라 기존 동작/문구 변경 없음.
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
  supportsHandsFreeControl: Platform.OS !== 'android',
  bluetoothHardwareVerified: bluetoothService.supportsHardwareRemote,
};

// 빌드당 고정값이라 Zustand 스토어로 만들 이유는 없지만(런타임에 변하지 않음), 컴포넌트에서
// `const { supportsAutoNext } = useCapabilities()`처럼 훅 스타일로 쓰고 싶을 때를 위한 얇은 래퍼.
export function useCapabilities(): AppCapabilities {
  return capabilities;
}
