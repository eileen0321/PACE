import { useEffect } from 'react';
import { AppState } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { useFlipStore } from '../store/useFlipStore';

// iOS Flip Mode (스펙 §4-A) — 기기를 엎어놓은 "내려놓은 시간(쉬는 시간)"을 측정한다.
// modules/pace-flip(CMMotionManager gravity.z)를 감싸 onFlip → useFlipStore로 계측한다.
// Metro가 iOS에서만 이 .ios.ts를 선택. 미빌드/시뮬(모션센서 없음)에선 graceful 비활성.
//
// ⚠️ iOS 제약 대응(핵심): 폰을 엎어놓으면 iOS가 화면을 끄고 앱이 background로 가 CoreMotion이
//    멈춘다. 그래서 background에선 "집어듦"을 센서로 감지할 수 없다. 대응:
//    - background 진입: 정산하지 않고 관찰만 멈춘다(진행 중인 쉼 flipStartMs 유지 — 스토어가 영속).
//    - foreground 복귀: 관찰 재개 후 잠깐 뒤 physicalFaceDown()으로 실제 상태를 재조율한다.
//      · 이미 집어들었으면(false) 그 사이 경과 전체를 정산(background 구간 브리징).
//      · 아직 엎어져 있으면(true) 계속 카운트(네이티브가 다시 face-down 확정하면 스토어 onFaceDown은
//        재진입 가드로 무시되어 flipStartMs가 보존된다).
type FlipModule = {
  start(): Promise<void>;
  stop(): void;
  isFaceDown(): boolean;
  physicalFaceDown(): boolean | null;
  addListener(event: 'onFlip', listener: (payload: { faceDown: boolean }) => void): { remove: () => void };
};

const RECONCILE_DELAY_MS = 800; // 복귀 후 최신 모션 샘플이 도착할 시간(0.2s 간격) 확보

export function useFlipMode({ enabled }: { enabled: boolean }) {
  const load = useFlipStore((s) => s.load);
  const onFaceDown = useFlipStore((s) => s.onFaceDown);
  const onFaceUp = useFlipStore((s) => s.onFaceUp);

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
      console.warn('[flip] ❌ 네이티브 모듈 미링크 — Dev Client 재빌드 필요(Flip Mode 비활성):', String(e));
      return;
    }

    const sub = mod.addListener('onFlip', ({ faceDown }) => {
      console.log('[flip]', faceDown ? '📵 엎어놓음(쉬는시간 시작)' : '📲 집어듦(정산)');
      if (faceDown) onFaceDown();
      else onFaceUp();
    });

    const startMotion = () => mod?.start().catch((err) => console.warn('[flip] start 실패:', String(err)));
    startMotion();

    // 화면이 꺼지는 순간(엎어놓기)을 놓치지 않도록 쉼 "시작"을 잡는다.
    //  - iOS는 폰을 엎으면 화면을 끈다. 자동잠금 전이면 앱은 'inactive'(화면만 off), 잠기면 'background'.
    //    어느 쪽이든 "그 순간 물리적으로 엎어져 있으면"(physicalFaceDown=true) 쉼을 시작한다.
    //    (2s 디바운스 확정 전에 화면이 꺼져도 누락 없게 — 30초 자동잠금에서 짧게 엎었다 드는 경우 포함.)
    //  - physicalFaceDown 게이트가 있어 알림 배너/제어센터 같은 face-up 일시상태에선 시작 안 한다.
    const captureRestStart = () => {
      if (!useFlipStore.getState().isFaceDown && mod?.physicalFaceDown() === true) {
        console.log('[flip] 📵 화면 off 순간 엎어져 있음 → 쉬는시간 시작(디바운스 레이스 보정)');
        onFaceDown();
      }
    };
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'inactive') {
        // 화면 off(아직 잠기지 않음). 쉼 시작만 포착 — 모션은 계속 돌 수 있으니 stop하지 않는다.
        captureRestStart();
      } else if (next === 'background') {
        // 잠김/완전 백그라운드: CoreMotion이 멈추므로 관찰 중단. 정산하지 않음(flipStartMs 유지 → 복귀 브리징).
        if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
        captureRestStart();
        try { mod?.stop(); } catch {}
      } else if (next === 'active') {
        startMotion();
        // 복귀 재조율: 그동안 집어들었는지 최신 샘플로 확인. 아직 샘플 없으면(null) 계속 카운트 유지.
        if (reconcileTimer) clearTimeout(reconcileTimer);
        reconcileTimer = setTimeout(() => {
          const resting = useFlipStore.getState().isFaceDown;
          if (resting && mod?.physicalFaceDown() === false) {
            console.log('[flip] 🔁 복귀 재조율 — 그 사이 집어듦 → 정산');
            onFaceUp();
          }
        }, RECONCILE_DELAY_MS);
      }
    });

    return () => {
      try { sub.remove(); } catch {}
      try { appSub.remove(); } catch {}
      if (reconcileTimer) clearTimeout(reconcileTimer);
      try { mod?.stop(); } catch {}
    };
  }, [enabled, onFaceDown, onFaceUp]);
}
