import { requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

// Pace iOS 핸즈프리 제스처 모듈 JS 바인딩 — iOS(apple) 전용(expo-module.config.json 참고).
// Android/web/Expo Go에서 requireNativeModule은 throw하므로 반드시 iOS + Dev Client 빌드에서만 로드.
// (useFeedRemoteControl.ios.ts가 try/catch 경계를 담당 — 로드 실패해도 앱은 죽지 않는다.)
//
// 네이티브는 "신호 감지"만 한다: 핑거스냅(SoundAnalysis) → onSnap, 고개짓(ARKit) → onHeadNod.
// "무엇을 할지"(다음/이전/토글)·디바운스·임계는 JS(useFeedRemoteControl.ios.ts)가 결정.
type PaceGestureNativeModule = {
  /** mode: 'snap' | 'head' | 'both' — 켤 감지기 선택. 마이크/카메라 권한을 내부에서 요청. */
  start(mode: 'snap' | 'head' | 'both'): Promise<void>;
  stop(): void;
  /** 고개짓(ARKit face)이 이 기기에서 지원되나(TrueDepth). 시뮬레이터/구형 기기는 false. */
  isHeadGestureSupported(): boolean;
  addListener(event: 'onSnap', listener: (payload: { confidence: number }) => void): EventSubscription;
  addListener(event: 'onHeadNod', listener: (payload: Record<string, never>) => void): EventSubscription;
  addListener(event: 'onError', listener: (payload: { kind: string; message: string }) => void): EventSubscription;
};

export const PaceGesture = requireNativeModule<PaceGestureNativeModule>('PaceGesture');
