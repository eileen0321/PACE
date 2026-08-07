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
  /** 물리 무음 스위치가 지금 켜져 있는지(0.2초 시스템사운드 타이밍 트릭, PaceVolumeKeyModule.swift 참고).
   *  WKWebView는 이 스위치를 못 보므로(플랫폼 버그, rdar://28716885) 직접 재는 수밖에 없다. */
  checkSilentSwitch(): Promise<boolean>;
  /** 2026-08-08 — 리모컨 토글과 무관하게 Shorts 재생 중 항상 켜는 감시자. 볼륨키를 누르면(방향 무관,
   *  값을 되돌리지 않음) 'onSilentUnmute' 이벤트를 쏜다 — "무음으로 시작해도 볼륨키를 누르면 소리
   *  나야 한다"(유튜브/인스타그램 관행) 대응용. */
  startSilentUnmuteWatch(): void;
  stopSilentUnmuteWatch(): void;
  addListener(event: 'onVolumeButton', listener: (payload: { direction: 'up' | 'down' }) => void): { remove: () => void };
  addListener(event: 'onSilentUnmute', listener: () => void): { remove: () => void };
};

export const PaceVolumeKey = requireNativeModule<PaceVolumeKeyNativeModule>('PaceVolumeKey');
