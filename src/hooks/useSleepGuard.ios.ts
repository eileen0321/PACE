import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

// iOS 취침 감지 가드 (스펙 §4-B) — 피드 시청 중 잠들면(무진동 지속) 강제 종료를 트리거한다.
// modules/pace-sleep(CMMotionManager userAcceleration + 오디오 라우트)를 감싼다. Android는 네이티브
// (PaceOverlayService)가 담당하므로 이 훅은 iOS 전용(.ios.ts), 그 외 no-op(.ts).
//
// 임계값(리서치 반영, 스펙 §4-B): 순수 무진동만으로 "잠들었다" 판단은 오탐 위험이 커 3분→10분으로 완화.
// 이어폰/블루투스 탈착은 "보조 신호"로만 — 단독 트리거 아님, 그 뒤로도 무진동이 이어질 때만 6분으로 단축.
// (통화하러 잠깐 뺐다 움직이면 millisSinceMotion이 리셋돼 발동 안 함.)
type SleepModule = {
  start(): Promise<void>;
  stop(): void;
  millisSinceMotion(): number;
  addListener(event: 'onAudioRouteLost', listener: () => void): { remove: () => void };
};

const DEFAULT_STILLNESS_MINUTES = 10; // 설정 미지정 시(안드 free 기본과 동일)
const TICK_MS = 20 * 1000; // 20초마다 검사

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

    let audioLost = false;
    let fired = false;
    m.start().catch((err) => { if (__DEV__) console.warn('[sleep] start 실패:', String(err)); });

    const sub = m.addListener('onAudioRouteLost', () => {
      audioLost = true; // 임계값 단축(무진동이 이어질 때만 실제 발동)
      if (__DEV__) console.log('[sleep] 🎧 오디오 라우트 끊김 → 임계값 단축(6분)');
    });

    const tick = setInterval(() => {
      if (fired) return;
      if (AppState.currentState !== 'active') return; // 포그라운드(화면 켜진 시청 중)에서만 인정
      const still = m.millisSinceMotion();
      const threshold = audioLost ? stillnessShortMs : stillnessMs;
      if (still >= threshold) {
        fired = true;
        if (__DEV__) console.log('[sleep] 😴 무진동', Math.round(still / 1000), 's → 취침 감지 → 종료');
        // ⭐ 안드 parity — 잠든 "실제 시각"은 임계값 넘긴 지금이 아니라 "마지막으로 움직인 시각"이다
        //    (지금 - 무진동 지속시간). 그 시각을 onSleep에 넘겨 DB ended_at에 정확히 기록되게 한다.
        onSleepRef.current(Date.now() - still);
      }
    }, TICK_MS);

    return () => {
      clearInterval(tick);
      try { sub.remove(); } catch {}
      try { m.stop(); } catch {}
    };
  }, [enabled, stillnessMs, stillnessShortMs]);
}
