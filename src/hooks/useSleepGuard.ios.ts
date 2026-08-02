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

// 2026-08-02 사장님 지시("수면 감지 기능 꺼 / 어차피 제대로 동작도 안 하잖아 / 수면감지 삭제해") +
// Android parity(fae0ff6). 취침 감지는 가속도계(폰의 물리적 움직임)만 보는데, 폰을 거치대/책상에 두고
// 손가락으로만 스와이프하며 보는 가장 흔한 사용 패턴에선 폰이 안 움직여 무진동=수면으로 오판했다 →
// 멀쩡히 시청 중인 세션을 강제 종료(피드 블랙아웃)시켰다(Android는 오버레이가 반복 소실). 오탐 비용이
// 이득보다 훨씬 커서 감지 자체를 비활성화한다. 되살릴 땐 이 플래그만 false로 되돌리면 됨(네이티브 모듈/
// 임계값/설정 배선은 그대로 둠). ⚠️ 이 훅은 "실시간 취침 감지"만 담당 — sleepBlackout의 다른 경로
// (슬립 타이머, idle 상한)와 백그라운드 이력 기반 수면 인사이트(_layout backfill)는 이와 무관하게 계속 동작.
const SLEEP_DETECTION_DISABLED = true;

// 2026-07-27 안드로이드 parity — 예전엔 임계값이 10분 하드코딩이라 설정의 sleepStillnessMinutes(안드는
// 사용, D8 프리미엄 조절 5~20분)를 무시했다. 이제 stillnessMinutes를 받아 임계값으로 쓴다. 오디오 라우트가
// 끊기면(이어폰 탈착 등 보조 신호) 그 60%로 단축(기존 10→6분 비율 유지).
export function useSleepGuard({ enabled, onSleep, stillnessMinutes }: { enabled: boolean; onSleep: (sleepOnsetAtMs?: number) => void; stillnessMinutes?: number }) {
  const onSleepRef = useRef(onSleep);
  onSleepRef.current = onSleep;
  // 2026-07-28 — 포그라운드 실시간 수면감지의 "책상 vs 수면" 오탐 완화(사장님 점심 실사용: 폰을 책상에 10분
  // 놔뒀더니 무진동=수면으로 오판돼 세션이 끝나 손짓이 꺼짐). 실제 잠든 시각 인사이트는 방법 B(백그라운드
  // 이력 조회, _layout backfill)가 별도로 처리하므로, 이 실시간 경로는 진짜 "오래 조는" 경우에만 발동하게
  // 하한 15분을 둔다(설정값이 더 크면 그 값 사용). 짧은 식사·잠깐 내려둠엔 안 터진다.
  const mins = Math.max(stillnessMinutes && stillnessMinutes > 0 ? stillnessMinutes : DEFAULT_STILLNESS_MINUTES, 15);
  const stillnessMs = mins * 60 * 1000;
  const stillnessShortMs = Math.round(mins * 0.6) * 60 * 1000;

  useEffect(() => {
    if (!enabled || SLEEP_DETECTION_DISABLED) return;
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
