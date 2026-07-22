import { useEffect } from 'react';
import { AppState } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { useFlipStore } from '../store/useFlipStore';

// iOS Flip Mode (스펙 §4-A) — 기기를 엎어놓은 "내려놓은 시간(쉬는 시간)"을 측정한다.
// modules/pace-flip(CMMotionManager gravity.z)를 감싸 onFlip → useFlipStore로 계측한다.
// Metro가 iOS에서만 이 .ios.ts를 선택. 미빌드/시뮬(모션센서 없음)에선 graceful 비활성.
//
// enabled일 때만 관찰 시작. AppState가 background로 가면 CoreMotion이 끊기므로(§4-A 문서화된 제약)
// 그 시점까지의 경과를 정산(onFaceUp)하고, 포그라운드로 돌아오면 다시 관찰을 시작한다.
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

    // background 진입 시 정산 후 관찰 중단, foreground 복귀 시 재개(CoreMotion 제약 보정).
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
