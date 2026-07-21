import { useEffect, useRef } from 'react';
import { requireNativeModule } from 'expo-modules-core';

// iOS 볼륨 버튼(에어팟/버즈/다이소 BT 리모컨) → "다음 Short" (2026-07-21 사용자 지시 (2)(3)).
// modules/pace-volumekey(AVAudioSession.outputVolume KVO)를 감싼다. Metro가 iOS에서만 이 .ios.ts 선택.
// 미빌드/시뮬(볼륨버튼 없음)에선 graceful 비활성.
//
// enabled일 때만 관찰 시작(피드 화면에 있을 때만). 볼륨 up/down 어느 쪽이든 onNext 호출.
type VolumeModule = {
  start(): Promise<void>;
  stop(): void;
  addListener(event: 'onVolumeButton', listener: (payload: { direction: 'up' | 'down' }) => void): { remove: () => void };
};

export function useVolumeNext({ enabled, onNext }: { enabled: boolean; onNext: () => void }) {
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  useEffect(() => {
    if (!enabled) return;
    let mod: VolumeModule | null = null;
    try {
      // ⚠️ 로컬 Expo 모듈은 상대경로 require('../../modules/..')가 Metro에서 해석 안 돼(감사 발견,
      // gesture 훅과 동일 버그) → requireNativeModule로 네이티브 모듈을 직접 로드해야 링크된다.
      mod = requireNativeModule<VolumeModule>('PaceVolumeKey');
    } catch (e) {
      console.warn('[volumekey] ❌ 네이티브 모듈 미링크 — Dev Client 재빌드 필요(볼륨키 비활성):', String(e));
      return;
    }
    const sub = mod.addListener('onVolumeButton', () => {
      console.log('[volumekey] 🔊 볼륨 버튼 → next');
      onNextRef.current();
    });
    mod.start().catch((err) => console.warn('[volumekey] start 실패:', String(err)));
    return () => {
      try { sub.remove(); } catch {}
      try { mod?.stop(); } catch {}
    };
  }, [enabled]);
}
