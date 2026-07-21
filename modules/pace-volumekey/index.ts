import { requireNativeModule } from 'expo-modules-core';

// Expo Modules API 로컬 모듈 — iOS 전용. 시스템 출력 볼륨(AVAudioSession.outputVolume) 변화를 관찰해
// "볼륨 버튼이 눌렸다"를 이벤트로 쏜다. 에어팟/버즈 볼륨 버튼과 다이소 BT 리모컨(볼륨 up/down HID)이
// 모두 시스템 볼륨을 바꾸므로 이 한 모듈로 (2)(3)을 통합 처리한다.
// PACE_ARCHITECTURE.md "iOS 볼륨키 리모컨" 참고.
//
// ⚠️ 시뮬레이터엔 물리 볼륨 버튼이 없어 검증 불가 → 실기기 + AirPods/BT 리모컨 필요.
// ⚠️ Dev Client/네이티브 재빌드가 있어야 링크됨(requireNativeModule은 미링크 시 throw).
type PaceVolumeKeyNativeModule = {
  /** 볼륨 관찰 시작. 이후 up/down 버튼마다 'onVolumeButton' 이벤트 발생. */
  start(): Promise<void>;
  stop(): void;
  addListener(event: 'onVolumeButton', listener: (payload: { direction: 'up' | 'down' }) => void): { remove: () => void };
};

export const PaceVolumeKey = requireNativeModule<PaceVolumeKeyNativeModule>('PaceVolumeKey');
