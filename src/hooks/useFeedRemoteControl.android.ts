import { useEffect, useRef } from 'react';

// 2026-07-20 — 8차 실기기 검증에서 Pace Feed가 실제 오디오를 재생하는 게 확정되면서(YouTubeShortsPlayer.tsx
// IFrame Embed API → 실제 youtube.com 페이지 네비게이션 전면 재작성), Android에서도 처음으로
// "Pace 자신이 진짜 재생자"인 케이스가 생겼다 — PaceOverlayService의 MediaSession은 실제 외부 앱
// (YouTube) 재생 중엔 하드웨어 버튼을 절대 못 가져온다는 게 7차에서 확정됐지만(PACE_ARCHITECTURE.md
// 참고), 여긴 다르다. modules/pace-overlay의 PaceFeedMediaSession(Kotlin)이 이 화면이 떠 있는 동안만
// 독립적인 MediaSession + AudioFocus를 잡고, 콜백을 "onFeedMediaCommand" 이벤트로 JS에 돌려준다.
// ⚠️ 실기기로 "버튼이 진짜 온다"까지는 아직 미검증(MediaSession 자체는 8차에서 처음 구현) — 다음
// 라운드에서 AirPods로 직접 눌러 확인 필요.
import type { PaceOverlay as PaceOverlayType } from '../../modules/pace-overlay';

let PaceOverlay: typeof PaceOverlayType | null = null;

try {
  PaceOverlay = require('../../modules/pace-overlay').PaceOverlay;
} catch (e) {
  console.warn('[useFeedRemoteControl.android] pace-overlay 네이티브 모듈 미링크(Dev Client 빌드 필요) — Bluetooth 리모컨 비활성화:', e);
}

type Callbacks = {
  onNext: () => void;
  onPrevious: () => void;
  onToggleAutoMode: () => void;
};

export function useFeedRemoteControl(callbacks: Callbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks; // 매 렌더 최신 콜백 유지 — stale closure 방지

  useEffect(() => {
    if (!PaceOverlay) return;
    PaceOverlay.startFeedMediaSession();
    // 2026-07-20 실기기 검증 중 발견: 네이티브 이벤트가 React 렌더 사이클과 타이밍이 겹치면
    // "Cannot update a component while rendering a different component" 경고(ToastHost 등 다른
    // 컴포넌트의 상태를 PaceFeedScreen 렌더 도중 바꾸려다 발생)가 뜬다 — setTimeout(0)으로 현재
    // 실행 중인 마이크로태스크/렌더 밖으로 콜백 실행을 미뤄 회피.
    const sub = PaceOverlay.addListener('onFeedMediaCommand', ({ action }) => {
      setTimeout(() => {
        if (action === 'next') callbacksRef.current.onNext();
        else if (action === 'previous') callbacksRef.current.onPrevious();
        else if (action === 'playPause') callbacksRef.current.onToggleAutoMode();
      }, 0);
    });
    return () => {
      sub.remove();
      PaceOverlay?.stopFeedMediaSession();
    };
  }, []);
}
