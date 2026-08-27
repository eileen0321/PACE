import { useEffect, useRef } from 'react';
import { requireNativeModule } from 'expo-modules-core';
import { diagLog } from '../services/diagLog';

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
  // 전환(YouTube 페이지 리로드 ~1.6s) 동안 손짓 추론을 멈춰 CPU를 페이지 로드에 양보 → 전환 체감 개선.
  // 고정 타임아웃으로 자동 재개(onReady 신호에 의존하지 않아 "ready 누락→영구 정지" 위험 없음).
  // 불응(네이티브 1200ms)이 어차피 재발화를 막으므로 이 구간에 손짓을 놓칠 일도 없다.
  // 손짓/볼륨뿐 아니라 자연 종료(onEnded)·수동 Next 등 "모든 전환"에서 불리게 피드 goNext가 직접 호출한다.
  const pauseWaveForTransition = () => {
    try {
      modRef.current?.setWavePaused?.(true);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => {
        try { modRef.current?.setWavePaused?.(false); } catch {}
      }, 500); // 2026-08-18 1600→500: 리로드 없는 SWIPE_NAV에선 긴 정지가 불필요한데, 1.6s 정지가
               // 빠른 연속 손짓(≤1.6s 간격)을 한 번 걸러 한 번씩 통째로 삼켰다("2번 중 2번째만" 재현).
               // 중복 발화는 네이티브 불응(1.2s)+JS 쿨다운(1.5s)이 계속 막는다.
    } catch {}
  };
  // 🔴 2026-08-25 사장님("왜 손짓이 안 됐는지 확인했어?") — 인식 실패의 물증이 없었다. 네이티브
  // onDiag는 Release에서도 오고 있었는데(모듈 sendEvent 비게이트) 아무도 저장을 안 했다. 여기서
  // 30초 창으로 집계해 pace_diag.log에 남긴다: 손이 잡힌 틱 수/no-hand 틱 수/최대 hand·growth·sweep/
  // 카메라 중단/발화 수 — "손은 잡혔는데 문턱 미달"과 "아예 안 잡힘"을 사후에 구분하는 근거.
  const diagAggRef = useRef({ handTicks: 0, noHandTicks: 0, maxHand: 0, maxGrowth: 0, maxSweep: 0, camInt: 0, waves: 0, since: Date.now() });
  const noteDiagForEvidence = (text: string) => {
    const a = diagAggRef.current;
    if (text.startsWith('crossskip')) { diagLog('cross_skip', text); return; } // 방향 한정으로 무시된 크로싱 — 부호 검증용
    if (text.startsWith('nearskip')) { diagLog('nearpass_skip', text); return; } // 근접 dip 오→왼 무시 — 방향 검증용
    if (text.startsWith('lumaskip')) { diagLog('lumapass_skip', text); return; } // 중거리 밝기 통과 오→왼 무시
    if (text.startsWith('crossdrop')) { diagLog('cross_drop_refractory', text); return; } // 불응 중 스트로크 폐기
    if (text.startsWith('camprobe') || text.startsWith('campixel')) { diagLog('cam_probe', text); return; } // 해상도·회전 원격 검증
    if (text.startsWith('returndrop')) { diagLog('return_drop', text); return; } // 복귀 스트로크 무시
    if (text.startsWith('gridnear')) { diagLog('grid_near', text); return; } // 격자 축 근접 미달 — 현장 캘리브레이션용
    if (text.startsWith('no hand')) a.noHandTicks += 1;
    else if (text.includes('cam interrupted')) a.camInt += 1;
    else if (text.includes('WAVE')) { a.waves += 1; diagLog('wave_fire', text); } // 발화 사유(축+수치)까지 물증에
    else {
      const m = text.match(/hand=([\d.]+) growth=([\d.]+) sweep=([\d.]+)/);
      if (m) {
        a.handTicks += 1;
        a.maxHand = Math.max(a.maxHand, parseFloat(m[1]));
        a.maxGrowth = Math.max(a.maxGrowth, parseFloat(m[2]));
        a.maxSweep = Math.max(a.maxSweep, parseFloat(m[3]));
      }
    }
    if (Date.now() - a.since >= 30000) {
      diagLog('wave_summary', `hand=${a.handTicks} nohand=${a.noHandTicks} maxHand=${a.maxHand.toFixed(3)} maxGrowth=${a.maxGrowth.toFixed(2)} maxSweep=${a.maxSweep.toFixed(2)} camInt=${a.camInt} waves=${a.waves}`);
      diagAggRef.current = { handTicks: 0, noHandTicks: 0, maxHand: 0, maxGrowth: 0, maxSweep: 0, camInt: 0, waves: 0, since: Date.now() };
    }
  };

  const fireNext = () => {
    const nowMs = Date.now();
    // 2026-08-18 실기기 로그로 확정 — 사장님 손짓 리듬(1.3~1.6s 간격)의 절반이 이 1500ms에 삼켜져
    // "한 번 걸러 한 번" 패턴을 만들었다(WAVE 발화 로그는 있는데 SWIPE가 없는 교대 패턴). 중복
    // 발화는 네이티브 불응(1200ms)이 이미 막으므로 JS 쿨다운은 이벤트 폭주 대비 최소값만 남긴다.
    // 800→400(2026-08-25) — 통과 전용 모드의 네이티브 불응이 0.5s로 내려가(사장님 "왜 그 시간을 막냐")
    // JS 쿨다운이 더 길면 여기서 삼킨다. 폭주 방지 최소값만 남긴다.
    if (nowMs - lastNextRef.current < 400) { diagLog('gesture_drop_cooldown'); return; }
    lastNextRef.current = nowMs;
    diagLog('gesture_next'); // 2026-08-25 재발 검증용 — Release에서도 남는 물증(services/diagLog.ts)
    cbRef.current.onNext(); // onNext(=피드 goNext)가 pauseWaveForTransition을 부른다 — 중복 방지 위해 여기선 안 부름
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
      mod.addListener('onDiag', (p) => {
        noteDiagForEvidence(String(p?.text ?? ''));
        cbRef.current.onDiag?.(p?.kind ?? '', p?.text ?? '');
      }),
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
      // 실명 채증(테스트 빌드 전용, 2026-08-26) — "됐다/실명" 반복의 원인을 프레임 사진으로 확정하기 위해
      // 감지기 가동 중 3초마다 1장 저장(Documents/wave_diag_frames). 출시 빌드에선 이 플래그가 false라 안 켜짐.
      mod.start('wave').then(() => {
        // ⚠️ 감지기는 start() 안에서 생성된다 — 그 전에 부르면 nil에 조용히 사라진다(프레임 채증이
        // 한 장도 안 찍히던 원인). start 완료 후에 켠다.
        if (process.env.EXPO_PUBLIC_AD_TEST_DEVICES === 'true') {
          try { (mod as unknown as { setDiagCapture?: (on: boolean) => void }).setDiagCapture?.(true); } catch {}
        }
      }).catch((err) => {
        runningRef.current = false;
        console.warn('[useFeedRemoteControl] 손짓(wave) start 실패:', err);
      });
    } else if (!active && runningRef.current) {
      runningRef.current = false;
      try { mod.stop(); } catch {}
    }
  }, [callbacks.headDetectActive]);

  // 피드가 모든 전환(goNext) 시작 시 호출 → 전환 동안 손짓 추론 정지(CPU를 페이지 로드에 양보).
  return { pauseWaveForTransition };
}
