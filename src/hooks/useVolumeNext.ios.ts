import { useEffect, useRef } from 'react';
import { requireNativeModule } from 'expo-modules-core';
import { bluetoothService } from '../services/platform';

// iOS 볼륨 버튼(에어팟/버즈/다이소 BT 리모컨) → Short 넘김 (2026-07-21 사용자 지시 (2)(3)).
// modules/pace-volumekey(AVAudioSession.outputVolume KVO)를 감싼다. Metro가 iOS에서만 이 .ios.ts 선택.
// 미빌드/시뮬(볼륨버튼 없음)에선 graceful 비활성.
//
// 2026-07-27 사용자 실기기 피드백 — 예전엔 up/down 둘 다 onNext라 볼륨↓가 무의미했다. 네이티브가 이미
// 방향(up/down)을 구분해 보내므로, 볼륨↑=다음 / 볼륨↓=이전으로 라우팅한다(onPrevious 없으면 둘 다 다음).
type VolumeModule = {
  start(): Promise<void>;
  stop(): void;
  addListener(event: 'onVolumeButton', listener: (payload: { direction: 'up' | 'down' }) => void): { remove: () => void };
};

export function useVolumeNext({ enabled, onNext, onPrevious }: { enabled: boolean; onNext: () => void; onPrevious?: () => void }) {
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const onPrevRef = useRef(onPrevious);
  onPrevRef.current = onPrevious;

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
    const sub = mod.addListener('onVolumeButton', (payload) => {
      // 2026-08-15 — 리모컨 "연결됨" 점의 유일하게 신뢰 가능한 신호(bluetoothService.ios.ts 주석
      // 참고). 폰 물리 볼륨버튼과는 실기기에서 구분이 안 되지만(iOS 플랫폼 한계, 기존 주석 참고),
      // 최소한 "무언가 눌렸다"는 사실 자체는 정직하게 보여준다.
      bluetoothService.reportRemoteActivity();
      if (payload?.direction === 'down' && onPrevRef.current) {
        if (__DEV__) console.log('[volumekey] 🔉 볼륨↓ → previous');
        onPrevRef.current();
      } else {
        if (__DEV__) console.log('[volumekey] 🔊 볼륨↑ → next');
        onNextRef.current();
      }
    });
    mod.start().catch((err) => console.warn('[volumekey] start 실패:', String(err)));
    return () => {
      try { sub.remove(); } catch {}
      try { mod?.stop(); } catch {}
    };
  }, [enabled]);
}
