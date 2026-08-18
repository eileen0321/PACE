import { useEffect, useRef } from 'react';
import { requireNativeModule } from 'expo-modules-core';
import { bluetoothService } from '../services/platform';

// iOS 볼륨 버튼(에어팟/버즈/다이소 BT 리모컨) → Short 넘김 (2026-07-21 사용자 지시 (2)(3)).
// modules/pace-volumekey(AVAudioSession.outputVolume KVO)를 감싼다. Metro가 iOS에서만 이 .ios.ts 선택.
// 미빌드/시뮬(볼륨버튼 없음)에선 graceful 비활성.
//
// 2026-07-27 사용자 실기기 피드백 — 예전엔 up/down 둘 다 onNext라 볼륨↓가 무의미했다. 네이티브가 이미
// 방향(up/down)을 구분해 보내므로, 볼륨↑=다음 / 볼륨↓=이전으로 라우팅한다(onPrevious 없으면 둘 다 다음).
//
// 🔴 2026-08-18 사장님 지적("리모컨 처음은 볼륨으로 되다가 영상으로 넘어가. 처음부터 체크 못해?") —
// 네이티브를 무장(start: 피드 진입 시 KVO/세션 예열)/개입(setEngaged: 포커스 온에 하이재킹)으로 분리.
// 켜자마자 누른 첫 눌림도 KVO가 이미 데워져 있어 즉시 잡힌다.
type VolumeModule = {
  start(): Promise<{ clampedFromZero?: boolean } | null | void>;
  stop(): void;
  setEngaged(on: boolean): Promise<{ clampedFromZero?: boolean } | null | void>;
  addListener(event: 'onVolumeButton', listener: (payload: { direction: 'up' | 'down' }) => void): { remove: () => void };
};

export function useVolumeNext({ enabled, armed, onNext, onPrevious, onZeroVolumeSession }: {
  /** 개입(하이재킹) 여부 — 포커스 세션 ON + 리모컨 설정 ON */
  enabled: boolean;
  /** 무장(감시 예열) 여부 — 피드 화면에 있고 리모컨 설정 ON(포커스 무관). 미지정 시 enabled와 동일. */
  armed?: boolean;
  onNext: () => void;
  onPrevious?: () => void;
  /** 2026-08-18 — 사용자가 볼륨 0인 채 리모컨 세션을 시작하면 네이티브가 감지용으로 1칸 클램프한다.
   *  그 사실을 알려 피드가 영상을 강제 muted로 잠가 "무음 유지 + 눌림 감지" 둘 다 만족시키게 한다.
   *  세션 종료 시 false로 다시 불린다. */
  onZeroVolumeSession?: (active: boolean) => void;
}) {
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const onPrevRef = useRef(onPrevious);
  onPrevRef.current = onPrevious;
  const onZeroRef = useRef(onZeroVolumeSession);
  onZeroRef.current = onZeroVolumeSession;
  const modRef = useRef<VolumeModule | null>(null);
  const isArmed = armed ?? enabled;

  // 무장 — KVO/오디오세션/모션 예열(볼륨은 추적만, 하이재킹 없음)
  useEffect(() => {
    if (!isArmed) return;
    let mod: VolumeModule | null = null;
    try {
      // ⚠️ 로컬 Expo 모듈은 상대경로 require('../../modules/..')가 Metro에서 해석 안 돼(감사 발견,
      // gesture 훅과 동일 버그) → requireNativeModule로 네이티브 모듈을 직접 로드해야 링크된다.
      mod = requireNativeModule<VolumeModule>('PaceVolumeKey');
    } catch (e) {
      console.warn('[volumekey] ❌ 네이티브 모듈 미링크 — Dev Client 재빌드 필요(볼륨키 비활성):', String(e));
      return;
    }
    modRef.current = mod;
    const sub = mod.addListener('onVolumeButton', (payload) => {
      // 2026-08-15 — 리모컨 "연결됨" 점의 유일하게 신뢰 가능한 신호(bluetoothService.ios.ts 주석
      // 참고). 폰 물리 볼륨버튼과는 실기기에서 구분이 안 되지만(iOS 플랫폼 한계, 기존 주석 참고),
      // 최소한 "무언가 눌렸다"는 사실 자체는 정직하게 보여준다.
      bluetoothService.reportRemoteActivity();
      // 2026-08-18 — 네이티브가 눌림을 실제 볼륨 조절로도 반영하며 "가상 0"(바닥에서 다운) 상태를
      // 같이 보낸다. 상태가 올 때마다 피드에 전달해 영상 muted 잠금/해제("무음에서도 볼륨키면 소리")를 맞춘다.
      const emu = (payload as { emulatedZero?: boolean } | null)?.emulatedZero;
      if (typeof emu === 'boolean') onZeroRef.current?.(emu);
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
      modRef.current = null;
      onZeroRef.current?.(false); // 무장 해제 — 강제 무음 해제(네이티브는 stop()에서 원래 볼륨 복원)
    };
  }, [isArmed]);

  // 개입 — 포커스 세션 토글에 맞춰 하이재킹 on/off(무장돼 있어야 의미 있음)
  useEffect(() => {
    const mod = modRef.current;
    if (!mod?.setEngaged) return;
    mod.setEngaged(enabled).then((res) => {
      if (enabled && res && (res as { clampedFromZero?: boolean }).clampedFromZero) {
        if (__DEV__) console.log('[volumekey] 볼륨 0 세션 — 감지용 1칸 클램프 + 영상 강제 무음');
        onZeroRef.current?.(true);
      }
      if (!enabled) onZeroRef.current?.(false); // 개입 종료 — 가상 0 잠금 해제
    }).catch((err) => console.warn('[volumekey] setEngaged 실패:', String(err)));
  }, [enabled, isArmed]);
}
