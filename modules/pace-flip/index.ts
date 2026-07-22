import { requireNativeModule } from 'expo-modules-core';

// Expo Modules API 로컬 모듈 — iOS 전용. CMMotionManager로 기기를 "엎어놓았는지(face-down)"를 감지해
// PACE Flip Mode(내려놓은 시간/쉬는 시간 측정, 스펙 §4-A)를 구현한다.
// gravity.z > 0.8 = 화면이 아래(엎어놓음), < -0.8 = 화면이 위(집어듦). 디바운스로 오탐 방지.
//
// ⚠️ iOS 제약(스펙 §4-A 문서화): 앱이 백그라운드로 가면 CoreMotion이 끊긴다 → "포그라운드/화면 켜진
//    상태에서만 인정"이 정직한 설계. JS(useFlipStore)는 이 이벤트 + AppState로 실제 경과를 계산한다.
// ⚠️ 시뮬레이터엔 모션 센서가 없어 검증 불가 → 실기기 필요. 미빌드 시 requireNativeModule throw.
type PaceFlipNativeModule = {
  /** 모션 관찰 시작. 이후 엎어놓음/집어듦마다 'onFlip' 이벤트({ faceDown: boolean }) 발생. */
  start(): Promise<void>;
  stop(): void;
  /** 지금 엎어놓은 상태인지 즉시 조회(관찰 중일 때만 유효). */
  isFaceDown(): boolean;
  addListener(event: 'onFlip', listener: (payload: { faceDown: boolean }) => void): { remove: () => void };
};

export const PaceFlip = requireNativeModule<PaceFlipNativeModule>('PaceFlip');
