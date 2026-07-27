import { useEffect, useRef } from 'react';
import { requireNativeModule } from 'expo-modules-core';

// iOS 취침 감지 가드 (스펙 §4-B) — 피드 시청 중 잠들면(무진동 지속) 강제 종료를 트리거한다.
// modules/pace-sleep(CMMotionManager userAcceleration + 오디오 라우트)를 감싼다. Android는 네이티브
// (PaceOverlayService)가 담당하므로 이 훅은 iOS 전용(.ios.ts), 그 외 no-op(.ts).
//
// 임계값(리서치 반영, 스펙 §4-B): 순수 무진동만으로 "잠들었다" 판단은 오탐 위험이 커 3분→10분으로 완화.
// 이어폰/블루투스 탈착은 "보조 신호"로만 — 단독 트리거 아님, 그 뒤로도 무진동이 이어질 때만 6분으로 단축.
// (통화하러 잠깐 뺐다 움직이면 millisSinceMotion이 리셋돼 발동 안 함.)
type SleepModule = {
  start(stillnessMs: number, shortMs: number): Promise<void>;
  stop(): void;
  millisSinceMotion(): number;
  addListener(event: 'onAudioRouteLost', listener: () => void): { remove: () => void };
  addListener(event: 'onSleepDetected', listener: (p: { stillMs: number }) => void): { remove: () => void };
};

const DEFAULT_STILLNESS_MINUTES = 10; // 설정 미지정 시(안드 free 기본과 동일)

// 2026-07-27 안드로이드 parity — 예전엔 임계값이 10분 하드코딩이라 설정의 sleepStillnessMinutes(안드는
// 사용, D8 프리미엄 조절 5~20분)를 무시했다. 이제 stillnessMinutes를 받아 임계값으로 쓴다. 오디오 라우트가
// 끊기면(이어폰 탈착 등 보조 신호) 그 60%로 단축(기존 10→6분 비율 유지).
export function useSleepGuard({ enabled, onSleep, stillnessMinutes }: { enabled: boolean; onSleep: (sleepOnsetAtMs?: number) => void; stillnessMinutes?: number }) {
  const onSleepRef = useRef(onSleep);
  onSleepRef.current = onSleep;
  const mins = stillnessMinutes && stillnessMinutes > 0 ? stillnessMinutes : DEFAULT_STILLNESS_MINUTES;
  const stillnessMs = mins * 60 * 1000;
  const stillnessShortMs = Math.round(mins * 0.6) * 60 * 1000;

  useEffect(() => {
    if (!enabled) return;
    let mod: SleepModule | null = null;
    try {
      mod = requireNativeModule<SleepModule>('PaceSleep');
    } catch (e) {
      if (__DEV__) console.warn('[sleep] ❌ 네이티브 모듈 미링크 — Dev Client 재빌드 필요(취침감지 비활성):', String(e));
      return;
    }
    const m = mod;
    let fired = false;

    // 무진동 "판정"은 이제 네이티브(PaceSleep)가 소유 — 임계값만 넘기고, 넘으면 onSleepDetected로 통보받는다.
    // 이렇게 해야 화면이 꺼져도(=실제 수면) 영상 오디오가 앱을 살려두는 동안 감지가 된다(예전 JS setInterval+
    // AppState 가드는 백그라운드에서 throttle·차단돼 "화면 켜고 조는" 경우만 잡혔다).
    m.start(stillnessMs, stillnessShortMs).catch((err) => { if (__DEV__) console.warn('[sleep] start 실패:', String(err)); });

    const sub = m.addListener('onSleepDetected', ({ stillMs }) => {
      if (fired) return;
      fired = true;
      if (__DEV__) console.log('[sleep] 😴 무진동', Math.round(stillMs / 1000), 's → 취침 감지(네이티브) → 종료');
      // ⭐ 잠든 "실제 시각" = 지금 - 무진동 지속시간(마지막으로 움직인 시각). DB ended_at에 그대로 기록.
      onSleepRef.current(Date.now() - stillMs);
    });

    return () => {
      try { sub.remove(); } catch {}
      try { m.stop(); } catch {}
    };
  }, [enabled, stillnessMs, stillnessShortMs]);
}
