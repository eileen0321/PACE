import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';

// 🔴 2026-08-10 사장님 지적("맥은 focus off에서 on 갈 때마다 타이머가 10분으로 리셋돼") —
//   Focus Session의 상태가 **화면 컴포넌트 안에만** 있었던 것이 원인이다. feed/index.tsx가
//   마감시각을 `useState`로, "시간이 다 돼서 꺼졌다"는 사실을 `useRef`로 들고 있어서, 피드 화면을
//   나갔다 오기만 해도(언마운트) 둘 다 사라졌다. 그러면:
//     1. 남은 시간이 없어지고 다시 켜면 **10분이 새로 시작**된다(사장님이 보신 그 증상).
//     2. 광고 게이트의 근거인 timedOut까지 사라져서 **광고 없이 무료 10분**이 나간다 —
//        보상광고 수익이 그대로 새는 경로다.
//   안드로이드는 같은 값을 네이티브 SharedPreferences에 저장해 프로세스가 죽어도 살아남는데
//   (PaceOverlayService의 PREF_FOCUS_SESSION_DEADLINE_AT_MS / PREF_FOCUS_TIMED_OUT_PENDING),
//   iOS에는 대응물이 없었다. 같은 개념을 같은 수명으로 맞추기 위한 스토어다.
//
// ⚠️ 플랫폼별 "집행"은 여전히 갈린다(안드는 네이티브 워처가 유튜브 앱 위에서 돌아야 하고, iOS는
//   인앱 WebView라 JS 타이머로 충분하다). 이 스토어가 통일하는 것은 집행 방식이 아니라 **규칙과
//   상태**다 — 마감시각이 언제인지, 타임아웃으로 꺼진 것인지. 그 두 가지가 양쪽에서 다르게
//   기억되는 한 규칙(10분 / +5분 / 하루 3회 / 광고 게이트)은 계속 어긋난다.

type PersistedFocusSession = { endsAt: number | null; timedOut: boolean };

type FocusSessionState = PersistedFocusSession & {
  /** load()가 끝났는지 — 끝나기 전에 화면이 세션 상태를 판단하면 "없음"으로 오인한다. */
  hydrated: boolean;
  load: () => Promise<void>;
  /** 새 세션 시작(사용자가 직접 켬). timedOut은 해제된다. */
  start: (durationMinutes: number) => void;
  /** 광고/크레딧 연장 — 남은 시간에 **더한다**(다시 시작이 아니다). */
  extend: (minutes: number) => void;
  /** 시간이 다 돼서 자동으로 꺼짐 — 광고 게이트가 이 값을 근거로 삼는다. */
  markTimedOut: () => void;
  /** 사용자가 직접 끔 — timedOut이 아니므로 다음 켜기는 게이트 없이 통과한다. */
  stop: () => void;
};

function persist(state: PersistedFocusSession) {
  // 저장 실패로 화면이 멈추면 안 된다 — 최악의 경우 예전(휘발) 동작으로 돌아갈 뿐이다.
  AsyncStorage.setItem(STORAGE_KEYS.focusSession, JSON.stringify(state)).catch(() => {});
}

export const useFocusSessionStore = create<FocusSessionState>((set, get) => ({
  endsAt: null,
  timedOut: false,
  hydrated: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusSession);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<PersistedFocusSession>;
        const endsAt = typeof saved.endsAt === 'number' ? saved.endsAt : null;
        const timedOut = saved.timedOut === true;
        // 앱이 꺼져 있는 동안 마감시각이 지났으면, 그건 "시간이 다 된" 것이다 — 되살릴 세션은
        // 없지만 timedOut은 세워야 한다. 안 그러면 앱을 껐다 켜는 것만으로 광고 게이트를 피할 수 있다.
        if (endsAt != null && endsAt <= Date.now()) {
          set({ endsAt: null, timedOut: true, hydrated: true });
          persist({ endsAt: null, timedOut: true });
          return;
        }
        set({ endsAt, timedOut, hydrated: true });
        return;
      }
    } catch {
      // 손상된 값이면 아래 기본값으로 폴백
    }
    set({ endsAt: null, timedOut: false, hydrated: true });
  },

  start: (durationMinutes) => {
    const next = { endsAt: Date.now() + durationMinutes * 60 * 1000, timedOut: false };
    set(next);
    persist(next);
  },

  extend: (minutes) => {
    // 남은 시간이 있으면 거기에 더하고, 없으면(타임아웃 직후 연장) 지금부터 센다.
    const base = Math.max(get().endsAt ?? 0, Date.now());
    const next = { endsAt: base + minutes * 60 * 1000, timedOut: false };
    set(next);
    persist(next);
  },

  markTimedOut: () => {
    const next = { endsAt: null, timedOut: true };
    set(next);
    persist(next);
  },

  stop: () => {
    const next = { endsAt: null, timedOut: false };
    set(next);
    persist(next);
  },
}));
