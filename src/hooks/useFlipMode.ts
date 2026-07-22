import { useEffect } from 'react';
import { AppState } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { useFlipStore } from '../store/useFlipStore';

// PACE Flip Mode(스펙 §4-A) — 기기를 엎어놓은 "내려놓은 시간(쉬는 시간)"을 측정한다.
// modules/pace-flip를 감싸 onFlip → useFlipStore로 계측한다. iOS(CMMotionManager)/
// Android(SensorManager) 둘 다 동일한 start/stop/isFaceDown/onFlip 인터페이스로 구현돼 있어
// 이 훅 하나로 양쪽 플랫폼을 다 커버한다(2026-07-23, Android 쪽 네이티브 모듈 추가로 공용화).
//
// enabled일 때만 관찰 시작. iOS는 앱이 백그라운드로 가면 CoreMotion이 끊기는 플랫폼 제약이 있고
// (§4-A 문서화), Android는 그런 제약이 없지만(SensorManager는 백그라운드에서도 계속 동작) 두 기기
// 동작 방식을 다르게 가져가면 사용자 체감이 플랫폼마다 달라지고 새 상시 포그라운드서비스/알림도
// 필요해져서, 이번 라운드는 의도적으로 양쪽 다 "포그라운드/화면 켜진 상태에서만 인정"으로 통일했다
// — background 진입 시 그 시점까지의 경과를 정산(onFaceUp)하고, 포그라운드로 돌아오면 재개.
type FlipModule = {
  start(): Promise<void>;
  stop(): void;
  isFaceDown(): boolean;
  addListener(event: 'onFlip', listener: (payload: { faceDown: boolean }) => void): { remove: () => void };
};

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

    // background 진입 시 정산 후 관찰 중단, foreground 복귀 시 재개.
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        onFaceUp(); // 엎어놓은 채 백그라운드면 그때까지의 쉬는시간을 은행에 넣는다(no-op if not face-down)
        try { mod?.stop(); } catch {}
      } else if (next === 'active') {
        startMotion();
      }
    });

    return () => {
      try { sub.remove(); } catch {}
      try { appSub.remove(); } catch {}
      try { mod?.stop(); } catch {}
    };
  }, [enabled, onFaceDown, onFaceUp]);
}
