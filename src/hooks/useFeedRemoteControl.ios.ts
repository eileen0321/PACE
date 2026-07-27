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
  /** 영상 전환(페이지 리로드) 동안 손짓 추론을 잠깐 멈춰 CPU를 로드에 양보(카메라는 유지). */
  setWavePaused(paused: boolean): void;
  addListener(event: 'onSnap' | 'onHeadNod' | 'onHandWave' | 'onDiag' | 'onError', listener: (payload: any) => void): { remove: () => void };
};

export function useFeedRemoteControl(callbacks: Callbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks; // 매 렌더 최신 콜백 유지(stale closure 방지)
  const modRef = useRef<GestureModule | null>(null);
  const runningRef = useRef(false);
  const lastNextRef = useRef(0);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 과발화 안전망(사용자 "한 손짓에 여러 번 넘어감"): 네이티브 재무장 게이트에 더해, JS에서도 직전
  // 넘김 후 1.5초 내 재호출은 무시한다(연속/누적 이벤트가 여러 영상을 순삭하는 것 방지).
  const fireNext = () => {
    const nowMs = Date.now();
    if (nowMs - lastNextRef.current < 1500) return;
    lastNextRef.current = nowMs;
    // 전환(YouTube 페이지 리로드 ~1.6s) 동안 손짓 추론을 멈춰 CPU를 페이지 로드에 양보 → 전환 체감 개선.
    // 고정 타임아웃으로 자동 재개(onReady 신호에 의존하지 않아 "ready 누락→영구 정지" 위험 없음).
    // 불응(네이티브 1200ms)이 어차피 재발화를 막으므로 이 구간에 손짓을 놓칠 일도 없다.
    try {
      modRef.current?.setWavePaused?.(true);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => {
        try { modRef.current?.setWavePaused?.(false); } catch {}
      }, 1600);
    } catch {}
    cbRef.current.onNext();
  };

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
      mod.addListener('onHeadNod', () => fireNext()),
      mod.addListener('onSnap', () => fireNext()),
      mod.addListener('onHandWave', () => fireNext()),
      mod.addListener('onDiag', (p) => cbRef.current.onDiag?.(p?.kind ?? '', p?.text ?? '')),
      mod.addListener('onError', (p) => console.warn('[pace-gesture]', p?.kind, p?.message)),
    ];
    return () => {
      subs.forEach((s) => { try { s.remove(); } catch {} });
      if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null; }
      try { mod?.stop(); } catch {}
      modRef.current = null;
      runningRef.current = false;
    };
  }, []);

  // 감지 게이팅: active면 손짓(전면카메라 Vision)만 시작. 핑거스냅은 AEC 없이 영상 소리를 주워들어
  // false 발화(영상이 멋대로 넘어감) → 피드 파괴. 안정 우선으로 'wave'만. (스냅 재개 시 주파수/ZCR
  // 게이트로 영상 소리 걸러야 함 — 실기기 로그: 진짜 스냅 hilo>1.2, 영상 소리 hilo~0.16.)
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
