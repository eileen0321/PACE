import { requireNativeModule } from 'expo-modules-core';

// Expo Modules API 로컬 모듈 — iOS+Android 공용(2026-07-23, Android 쪽 네이티브 모듈 추가로 공용화).
// iOS는 CMMotionManager, Android는 SensorManager로 기기를 "엎어놓았는지(face-down)"를 감지해
// PACE Flip Mode(내려놓은 시간/쉬는 시간 측정, 스펙 §4-A)를 구현한다. 양쪽 다 gravity.z 임계값 +
// 디바운스로 오탐 방지(단, z축 부호는 플랫폼마다 반대 — 각 네이티브 모듈 주석 참고).
//
// ⚠️ 플랫폼 제약(스펙 §4-A 문서화): iOS는 앱이 백그라운드로 가면 CoreMotion이 끊기고, Android는
//    기술적으로는 계속 동작 가능하지만 플랫폼 간 체감 통일을 위해 의도적으로 동일하게 제한 —
//    "포그라운드/화면 켜진 상태에서만 인정"이 양쪽 다 정직한 설계. JS(useFlipMode.ts)는 이 이벤트 +
//    AppState + physicalFaceDown()으로 백그라운드 구간까지 브리징해 실제 경과를 계산한다.
// ⚠️ 시뮬레이터/일부 에뮬레이터엔 모션 센서가 없어 검증 불가 → 실기기 필요. 미빌드 시 requireNativeModule throw.
type PaceFlipNativeModule = {
  /** 모션 관찰 시작. 이후 엎어놓음/집어듦마다 'onFlip' 이벤트({ faceDown: boolean }) 발생. */
  start(): Promise<void>;
  stop(): void;
  /** 디바운스 확정된 엎어놓음 상태(관찰 중일 때만 유효). */
  isFaceDown(): boolean;
  /** 디바운스 없이 지금 이 순간 물리적으로 엎어져 있나(background 복귀 재조율용). 샘플 없으면 null. */
  physicalFaceDown(): boolean | null;
  addListener(event: 'onFlip', listener: (payload: { faceDown: boolean }) => void): { remove: () => void };
};

export const PaceFlip = requireNativeModule<PaceFlipNativeModule>('PaceFlip');
