import { useEffect } from 'react';
import { AppState } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { useFlipStore } from '../store/useFlipStore';

// PACE Flip Mode(스펙 §4-A) — 기기를 엎어놓은 "내려놓은 시간(쉬는 시간)"을 측정한다. iOS+Android 공용.
// modules/pace-flip를 감싸 onFlip → useFlipStore로 계측한다. iOS(CMMotionManager)/Android(SensorManager)
// 둘 다 동일한 start/stop/isFaceDown/physicalFaceDown/onFlip 인터페이스라 이 훅 하나로 양쪽을 커버한다.
//
// ⚠️ 핵심 제약 대응(정상/비정상 처리, 상세는 useFlipStore.ts 상단): 폰을 엎으면 화면이 꺼지고 앱이
//    background로 가 모션 관찰이 멈춘다(iOS는 OS 강제, Android는 플랫폼 간 체감 통일을 위한 의도적 설계).
//    - inactive/background 진입: "그 순간 물리적으로 엎어져 있으면" 쉼 시작을 포착(디바운스 확정 전에
//      화면이 꺼져도 누락 없게 — 자동잠금 전 화면off는 'inactive', 잠금은 'background').
//    - background: 관찰 중단(flipStartMs는 스토어가 영속 → 복귀 시 브리징).
//    - foreground 복귀: 관찰 재개 후 여러 번 physicalFaceDown()으로 재조율 — 이미 집어들었으면(false)
//      그 사이 경과를 정산. 아직 샘플 없으면(null) 다음 시도(감사 C3 재시도 — stuck 방지).
type FlipModule = {
  start(): Promise<void>;
  stop(): void;
  isFaceDown(): boolean;
  physicalFaceDown(): boolean | null;
  addListener(event: 'onFlip', listener: (payload: { faceDown: boolean }) => void): { remove: () => void };
};

// 복귀 재조율 재시도 스케줄(감사 C3) — 첫 non-null 샘플에서 판정. 마지막까지 null이면 안전하게 정산(집어듦 간주).
const RECONCILE_DELAYS_MS = [500, 1200, 2500];

export function useFlipMode({ enabled }: { enabled: boolean }) {
  const load = useFlipStore((s) => s.load);
  const onFaceDown = useFlipStore((s) => s.onFaceDown);
  const onFaceUp = useFlipStore((s) => s.onFaceUp);
  const rollDateIfNeeded = useFlipStore((s) => s.rollDateIfNeeded);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    let mod: FlipModule | null = null;
    try {
      // 로컬 Expo 모듈은 requireNativeModule로 직접 로드(볼륨키/제스처 훅과 동일 — 상대경로 require는 Metro 미해석).
      mod = requireNativeModule<FlipModule>('PaceFlip');
    } catch (e) {
      if (__DEV__) console.warn('[flip] ❌ 네이티브 모듈 미링크 — Dev Client 재빌드 필요(Flip Mode 비활성):', String(e));
      return;
    }
    const m = mod;

    const sub = m.addListener('onFlip', ({ faceDown }) => {
      if (__DEV__) console.log('[flip]', faceDown ? '📵 엎어놓음(쉬는시간 시작)' : '📲 집어듦(정산)');
      if (faceDown) onFaceDown();
      else onFaceUp();
    });

    // 중복 start 방지(감사 M2) — inactive는 stop 안 하므로 active 복귀 시 이미 돌고 있으면 재시작 생략.
    let started = false;
    const startMotion = () => {
      if (started) return;
      started = true;
      m.start().catch((err) => {
        started = false;
        if (__DEV__) console.warn('[flip] start 실패:', String(err));
      });
    };
    const stopMotion = () => {
      started = false;
      try { m.stop(); } catch {}
    };
    startMotion();

    // 화면 off 순간(엎어놓기) 쉼 "시작" 포착 — physicalFaceDown 게이트로 배너/제어센터(face-up) 일시상태는 제외.
    const captureRestStart = () => {
      if (!useFlipStore.getState().isFaceDown && m.physicalFaceDown() === true) {
        if (__DEV__) console.log('[flip] 📵 화면 off 순간 엎어져 있음 → 쉬는시간 시작(디바운스 레이스 보정)');
        onFaceDown();
      }
    };

    // 복귀 재조율(감사 C3) — 여러 시점에 확인, 첫 확정 샘플에서 결정. 마지막까지 null이면 정산(active인데
    // 샘플이 안 오면 센서 이상 → stuck 방지 위해 집어듦으로 간주).
    let reconcileTimers: ReturnType<typeof setTimeout>[] = [];
    const clearReconcile = () => {
      reconcileTimers.forEach((t) => clearTimeout(t));
      reconcileTimers = [];
    };
    const scheduleReconcile = () => {
      clearReconcile();
      let done = false;
      reconcileTimers = RECONCILE_DELAYS_MS.map((delay, i) =>
        setTimeout(() => {
          if (done) return;
          if (!useFlipStore.getState().isFaceDown) { done = true; return; }
          const phys = m.physicalFaceDown();
          const isLast = i === RECONCILE_DELAYS_MS.length - 1;
          if (phys === false || (phys == null && isLast)) {
            done = true;
            if (__DEV__) console.log('[flip] 🔁 복귀 재조율 — 그 사이 집어듦 → 정산', phys == null ? '(샘플 없음 안전정산)' : '');
            onFaceUp();
          } else if (phys === true) {
            done = true; // 여전히 엎어짐 → 계속 카운트(네이티브가 이후 집어듦 전이를 잡음)
          }
          // phys == null && !isLast → 다음 타이머에서 재시도
        }, delay)
      );
    };

    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'inactive') {
        // 화면 off(아직 잠기지 않음). 쉼 시작만 포착 — 모션은 계속 돌 수 있으니 stop하지 않는다.
        clearReconcile(); // 복귀 재조율 진행 중 다시 inactive면 취소(감사 M3)
        captureRestStart();
      } else if (next === 'background') {
        // 잠김/완전 백그라운드: 모션 관찰이 멈추므로 관찰 중단. 정산하지 않음(flipStartMs 유지 → 복귀 브리징).
        clearReconcile();
        captureRestStart();
        stopMotion();
      } else if (next === 'active') {
        rollDateIfNeeded(); // 열린 채 자정 넘겼으면 새 날로 롤오버(감사 H2)
        startMotion();
        scheduleReconcile();
      }
    });

    return () => {
      try { sub.remove(); } catch {}
      try { appSub.remove(); } catch {}
      clearReconcile();
      stopMotion();
    };
  }, [enabled, onFaceDown, onFaceUp, rollDateIfNeeded]);
}
