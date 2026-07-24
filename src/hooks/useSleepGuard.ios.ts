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

const SLEEP_STILLNESS_MS = 10 * 60 * 1000;
const SLEEP_STILLNESS_SHORT_MS = 6 * 60 * 1000;
const TICK_MS = 20 * 1000; // 20초마다 검사

export function useSleepGuard({ enabled, onSleep }: { enabled: boolean; onSleep: () => void }) {
  const onSleepRef = useRef(onSleep);
  onSleepRef.current = onSleep;

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
      const threshold = audioLost ? SLEEP_STILLNESS_SHORT_MS : SLEEP_STILLNESS_MS;
      if (still >= threshold) {
        fired = true;
        if (__DEV__) console.log('[sleep] 😴 무진동', Math.round(still / 1000), 's → 취침 감지 → 종료');
        onSleepRef.current();
      }
    }, TICK_MS);

    return () => {
      clearInterval(tick);
      try { sub.remove(); } catch {}
      try { m.stop(); } catch {}
    };
  }, [enabled]);
}
