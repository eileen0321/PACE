import { useEffect, useRef } from 'react';
import { requireNativeModule } from 'expo-modules-core';

// iOS 전용 핸즈프리 "다음 영상" 트리거 (2026-07-20).
// modules/pace-gesture(Expo Modules API 로컬 모듈, Swift)를 감싼다.
//
// ── 방식 전환(2026-07-20): 핑거스냅 → 고개짓 ─────────────────────────────────────────────
// 처음엔 핑거스냅 소리(SoundAnalysis)로 넘겼는데, Android 실사용에서 "쇼츠 오디오에 스냅 소리가
// 묻혀 감지가 잘 안 됨"이 확인됐다. 그래서 iOS는 **ARKit 얼굴 트래킹(TrueDepth) 고개짓**으로 전환 —
// 소리와 완전 무관(시각/깊이)이라 오디오 마스킹 문제가 원천적으로 없고, iPhone TrueDepth라 RGB 손
// 인식보다 강건하며 새 의존성 0개다. 감지는 배터리를 위해 **headDetectActive**(피드가 "Focus Session
// 켜짐 + 현재 영상 1/2지점 이후"로 계산)일 때만 켠다 — 카메라 상시 구동 방지. 고개짓 → onNext().
// 스냅 리스너도 등록은 해두지만(감지기는 안 켬) 향후 AEC로 되살릴 여지만 남긴다.
// ⚠️ Metro가 iOS 빌드에서만 이 .ios.ts를 선택. 미빌드/시뮬(TrueDepth 없음)에선 graceful 처리.

type Callbacks = {
  onNext: () => void;
  onPrevious: () => void;
  onToggleAutoMode: () => void;
  /** 고개짓 감지를 켤지 — 피드가 (Focus Session ON && 현재 영상 진행률 ≥ 0.5)로 계산해 넘긴다. */
  headDetectActive?: boolean;
  /** 디버그: 네이티브 감지 진단 텍스트("hand=0.12", "SPIKE ...", "no hand" 등) — 피드가 화면에 표시. */
  onDiag?: (kind: string, text: string) => void;
};

type GestureModule = {
  start(mode: 'snap' | 'head' | 'wave' | 'both'): Promise<void>;
  stop(): void;
  isHeadGestureSupported(): boolean;
  addListener(event: 'onSnap' | 'onHeadNod' | 'onHandWave' | 'onDiag' | 'onError', listener: (payload: any) => void): { remove: () => void };
};

export function useFeedRemoteControl(callbacks: Callbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks; // 매 렌더 최신 콜백 유지(stale closure 방지)
  const modRef = useRef<GestureModule | null>(null);
  const runningRef = useRef(false);

  // 마운트: 네이티브 모듈 로드 + 이벤트 리스너 등록. 감지 start는 아래 headDetectActive effect가 제어.
  // (로컬 Expo 모듈은 상대경로 require가 Metro에서 안 잡혀 requireNativeModule을 직접 쓴다. 마운트
  //  시점 로드로 탑레벨 평가 타이밍 이슈 방지. 미빌드/시뮬에선 throw → graceful 비활성.)
  useEffect(() => {
    let mod: GestureModule | null = null;
    try {
      mod = requireNativeModule<GestureModule>('PaceGesture');
    } catch (e) {
      console.warn('[useFeedRemoteControl] pace-gesture 네이티브 모듈 미링크 — 핸즈프리 비활성:', e);
      return;
    }
    modRef.current = mod;
    const subs = [
      mod.addListener('onHeadNod', () => cbRef.current.onNext()),
      mod.addListener('onSnap', () => cbRef.current.onNext()),
      mod.addListener('onHandWave', () => cbRef.current.onNext()),
      mod.addListener('onDiag', (p) => cbRef.current.onDiag?.(p?.kind ?? '', p?.text ?? '')),
      mod.addListener('onError', (p) => console.warn('[pace-gesture]', p?.kind, p?.message)),
    ];
    return () => {
      subs.forEach((s) => { try { s.remove(); } catch {} });
      try { mod?.stop(); } catch {}
      modRef.current = null;
      runningRef.current = false;
    };
  }, []);

  // 감지 게이팅: active면 손짓(전면카메라 Vision) 시작, 꺼지면 정지. Focus Session 동안만 켜짐.
  // ⚠️ 2026-07-26 실기기 결정: 핑거스냅('snap', AVAudioEngine 마이크)은 WebView(유튜브) 오디오와
  // 충돌 시 engine.start가 Swift try/catch로 못 잡는 ObjC NSException(-10868 "Failed to initialize
  // active nodes in input chain")을 던져 앱이 계속 죽는다(실기기 로그 확인). 오디오 세션을 안 건드리는
  // 방식으로 재작성하기 전까지 스냅은 비활성 → 'wave'만. 다음 넘김은 손짓 + 볼륨키(리모컨) + 자동넘김.
  useEffect(() => {
    const mod = modRef.current;
    if (!mod) return;
    const active = !!callbacks.headDetectActive;
    if (active && !runningRef.current) {
      runningRef.current = true;
      mod.start('wave').catch((err) => {
        runningRef.current = false;
        console.warn('[useFeedRemoteControl] 손짓(wave) start 실패:', err);
      });
    } else if (!active && runningRef.current) {
      runningRef.current = false;
      try { mod.stop(); } catch {}
    }
  }, [callbacks.headDetectActive]);
}
