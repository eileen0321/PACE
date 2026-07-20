import { create } from 'zustand';
import type { ShortFormApp } from '../constants/apps';

// 외부 리뷰 반영(2026-07-17, 4차): 세션의 "주체" 상태를 한 곳에 모은다. useTimerStore는 카운트다운
// 숫자(remaining/sleep)만 다루고, useAutoNextStore는 Auto Next 런타임 on/off만 다뤘다 — 정작
// "지금 세션이 어떤 앱에서, 언제 시작해서, 지금 running/paused/finished 중 뭔지"를 묻는 단일 창구가
// 없었다. Overlay/Live Activity 네이티브 모듈이 붙으면 이 스토어가 그 브릿지의 JS측 진실원천이 된다.
export type SessionStatus = 'idle' | 'running' | 'finished';

type SessionState = {
  currentSessionId: string | null;
  platformApp: ShortFormApp | null;
  startedAt: Date | null;
  status: SessionStatus;
  start: (params: { sessionId: string; platformApp: ShortFormApp | null }) => void;
  finish: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  currentSessionId: null,
  platformApp: null,
  startedAt: null,
  status: 'idle',

  start: ({ sessionId, platformApp }) => {
    set({ currentSessionId: sessionId, platformApp, startedAt: new Date(), status: 'running' });
  },

  finish: () => {
    set({ currentSessionId: null, platformApp: null, startedAt: null, status: 'finished' });
  },
}));
