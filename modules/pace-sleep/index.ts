import { requireOptionalNativeModule } from 'expo-modules-core';

// Pace iOS 취침 감지 프리미티브 (스펙 §4-B). Android는 PaceOverlayService.kt(evaluateSleepStages,
// 2026-08-04 2단계 재설계)가 담당하고, iOS는 이 모듈이 등가 raw 신호를 제공한다 — 단 iOS는 background
// CoreMotion 제약으로 "포그라운드(피드 시청 중)에서 잠든" 케이스만 감지(정직한 설계, §4-B 문서화).
//
// 판정(무입력 경과·단계 전이·타임아웃)은 JS(useSleepGuard.ios.ts)가 소유 — native는 raw 신호만:
//  - gravityZ(): deviceMotion.gravity의 Z축(G, -1..1) — "기기가 눕혀졌는가"(Android TYPE_GRAVITY 등가).
//  - isCharging(): UIDevice.batteryState 기반.
//  - 블루투스/이어폰 탈착(보조 신호): AVAudioSession.routeChangeNotification의 .oldDeviceUnavailable →
//    onAudioRouteLost.
type PaceSleepNativeModule = {
  /** 관찰 시작(deviceMotion + 배터리 모니터링 + 오디오 라우트 감시). */
  start(): Promise<void>;
  stop(): void;
  /** 최근 관측된 중력 Z축(G, -1..1). 관찰 중이 아니면 0. */
  gravityZ(): number;
  isCharging(): boolean;
  addListener(event: 'onAudioRouteLost', listener: () => void): { remove: () => void };
};

export const PaceSleep = requireOptionalNativeModule<PaceSleepNativeModule>('PaceSleep');
