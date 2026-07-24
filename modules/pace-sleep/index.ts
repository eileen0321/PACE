import { requireOptionalNativeModule } from 'expo-modules-core';

// Pace iOS 취침 감지 프리미티브 (스펙 §4-B). Android는 PaceOverlayService.kt(TYPE_LINEAR_ACCELERATION +
// AlarmManager tick)가 담당하고, iOS는 이 모듈이 등가 신호를 제공한다 — 단 iOS는 background CoreMotion
// 제약으로 "포그라운드(피드 시청 중)에서 잠든" 케이스만 감지(정직한 설계, §4-B 문서화).
//
// 신호(리서치 반영, 2026-07-24):
//  - 무진동: CMMotionManager deviceMotion의 userAcceleration(중력 제거된 순수 움직임) 크기가 작은
//    상태가 이어지면 "정지". iOS엔 OS 레벨 sleep/wake API가 없어(Apple 포럼 확인) 이 방식이 정석.
//    native는 "마지막으로 의미있는 움직임이 있은 뒤 경과(ms)"만 제공하고, 몇 분을 재울지(임계값) 판단은
//    JS(useSleepGuard)가 소유 — 튜닝/검증이 쉽다.
//  - 블루투스/이어폰 탈착(보조 신호): AVAudioSession.routeChangeNotification의 .oldDeviceUnavailable →
//    onAudioRouteLost. 단독 트리거 아님(통화하러 잠깐 뺀 경우와 구분 불가) — 무진동이 이어질 때만 임계값 단축.
type PaceSleepNativeModule = {
  /** 무진동 관찰 시작(deviceMotion + 오디오 라우트 감시). */
  start(): Promise<void>;
  stop(): void;
  /** 마지막으로 의미있는 움직임이 있은 뒤 경과(ms). 관찰 중이 아니면 0. */
  millisSinceMotion(): number;
  addListener(event: 'onAudioRouteLost', listener: () => void): { remove: () => void };
};

export const PaceSleep = requireOptionalNativeModule<PaceSleepNativeModule>('PaceSleep');
