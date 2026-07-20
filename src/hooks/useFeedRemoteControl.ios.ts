import { useEffect, useRef } from 'react';
import { requireNativeModule } from 'expo-modules-core';

// iOS 전용 핸즈프리 "다음 영상" 트리거 (2026-07-20, 사용자 지시로 AirPods Bluetooth 방식에서 전환).
// modules/pace-gesture(Expo Modules API 로컬 모듈, Swift)를 감싼다:
//   · 핑거스냅 소리 → SoundAnalysis 내장 분류기(finger_snapping) → onSnap → onNext()
//   · 고개짓(턱 끄덕임) → ARKit face tracking(TrueDepth 기기 전용) → onHeadNod → onNext()
// ⚠️ 미링크/미빌드(prebuild 전, 시뮬레이터 등)에서도 앱이 죽지 않도록 require를 try/catch로 감싼다.
// ⚠️ Metro가 iOS 빌드에서만 이 .ios.ts를 선택 — Android는 useFeedRemoteControl.android.ts(네이티브
//    미디어세션) 사용. onPrevious/onToggleAutoMode는 제스처엔 매핑하지 않는다(화면 버튼 전용).

type Callbacks = {
  onNext: () => void;
  onPrevious: () => void;
  onToggleAutoMode: () => void;
};

type GestureModule = {
  start(mode: 'snap' | 'head' | 'both'): Promise<void>;
  stop(): void;
  isHeadGestureSupported(): boolean;
  addListener(event: 'onSnap' | 'onHeadNod' | 'onError', listener: (payload: any) => void): { remove: () => void };
};

export function useFeedRemoteControl(callbacks: Callbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks; // 매 렌더 최신 콜백 유지(stale closure 방지)

  useEffect(() => {
    // 로컬 Expo 모듈은 상대경로 require가 Metro에서 안 잡혀(index.ts 미해석) requireNativeModule을 직접
    // 쓴다. 모듈-탑레벨이 아니라 마운트 시점에 로드 — Metro 캐시 재빌드 등으로 탑레벨 평가가 네이티브
    // 등록 전에 튀는 것을 방지(검증 중 간헐적 '미링크' 발견). 미빌드/시뮬에선 throw하므로 try/catch.
    let mod: GestureModule | null = null;
    try {
      mod = requireNativeModule<GestureModule>('PaceGesture');
    } catch (e) {
      console.warn('[useFeedRemoteControl] pace-gesture 네이티브 모듈 미링크 — 핸즈프리 제스처 비활성:', e);
      return;
    }
    const subs: Array<{ remove: () => void }> = [];
    try {
      // 스펙(PACE_ARCHITECTURE.md 2026-07-20): 핑거스냅이 확정 기능. 고개짓(ARKit)은 "보류/사용자
      // 결정 대기"라 기본 비활성 — 네이티브엔 구현돼 있어(mode 'head'/'both') 결정되면 바로 켤 수 있다.
      // (참고: 문서는 고개짓에 vision-camera+MediaPipe를 가정했으나 iOS는 ARKit로 새 의존성 0개 구현함.)
      mod.start('snap').catch((err) =>
        console.warn('[useFeedRemoteControl] 제스처 start 실패:', err),
      );
      subs.push(mod.addListener('onSnap', () => cbRef.current.onNext()));
      subs.push(mod.addListener('onHeadNod', () => cbRef.current.onNext()));
      subs.push(mod.addListener('onError', (p) => console.warn('[pace-gesture]', p?.kind, p?.message)));
    } catch (e) {
      console.warn('[useFeedRemoteControl] 제스처 리스너 등록 실패:', e);
    }
    // 언마운트 시 반드시 정리 — 마이크/카메라/ARSession을 놓아준다(구 TrackPlayer 누수 대응).
    return () => {
      subs.forEach((s) => { try { s.remove(); } catch {} });
      try { mod.stop(); } catch {}
    };
  }, []);
}
