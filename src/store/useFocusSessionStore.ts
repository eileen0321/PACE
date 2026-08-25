import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';
import { focusAllowanceApi } from '../services/api/client';

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

// 재설치 직후 서버 판단을 기다리는 최대 시간 — 위 load() 주석 참고(오프라인 fail-open).
const FRESH_INSTALL_MERGE_TIMEOUT_MS = 3000;

// 🔴 2026-08-20 사장님 제보(iOS) — "며칠 쇼츠도 안 봤는데 포커스 ON 누르니 다 소진했다고
//   광고 보란 팝업이 뜬다". 저장값에 **날짜가 없던 것**이 원인이다.
//   한 번 timedOut=true가 되면 자정이 지나도 안 풀리고, 아래 mergeServer가 서버값과 OR로
//   합치므로(`state.timedOut || server.timedOut`) 서버가 오늘은 false라고 해도 로컬의 true가
//   이긴다. 결과적으로 **한 번 만료되면 영원히 광고를 봐야 한다** — 오랜만에 앱을 연 사용자가
//   첫 화면에서 광고를 요구받는, 이탈로 직결되는 경로였다.
//   ⚠️ 내가 2026-08-13에 이 코드를 보고 "서버가 OR로 병합하니 게이트가 유지된다"며 정상으로
//     판단하고 넘어갔다. 남용 차단 쪽만 보고 "안 쓴 사용자가 영구히 막힌다"는 반대편을 안 봤다.
//   → 저장값에 날짜를 넣고, 날짜가 다르면 버린다. 서버가 이미 allowance_date로 날짜별 관리를
//     하므로 그쪽 규칙에 맞추는 것이다. 같은 날 안에서는 예전과 완전히 동일하게 동작하므로
//     남용 차단(하루 광고 3회 상한, timedOut 게이트)은 그대로다.
type PersistedFocusSession = { date: string; endsAt: number | null; timedOut: boolean };

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
  // 🔴 2026-08-10 — 로컬만으로는 앱을 지웠다 깔면 통째로 초기화된다(사장님 지적). 서버에도 남긴다.
  //   서버는 덮어쓰지 않고 병합한다(timedOut은 OR, 마감시각은 더 나중 것) — 재설치 후 올라온
  //   빈 상태가 기존 기록을 지우지 못한다. 실패는 삼킨다(오프라인에서 세션이 멈추면 안 된다).
  focusAllowanceApi
    .sync({
      date: todayKey(),
      adExtendCount: 0, // 이 스토어는 횟수를 모른다 — max 병합이라 0은 서버 값을 낮추지 않는다
      timedOut: state.timedOut,
      sessionEndsAt: state.endsAt != null ? new Date(state.endsAt).toISOString() : null,
    })
    .catch(() => {});
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 서버 기록을 로컬에 합친다. 앱을 지웠다 깔아 로컬이 비어 있어도 서버가 "이미 시간이 다 됐다"를
 * 기억하므로 무료 세션이 다시 나가지 않는다. 오프라인이면 아무것도 안 하고 로컬 값으로 간다(fail-open).
 *
 * 🔴 2026-08-11 사장님 실기기 지적("애플에서 광고 보고 나오니 포커스 2분이야, 광고 시간까지 깐 거
 *   같은데") — 내가 넣은 결함이었다. 원래 여기서 마감시각을 `Math.min`으로 **더 이른 쪽에 클램프**
 *   했다. 남용을 막겠다고 "불리한 쪽으로만 움직인다"는 규칙을 마감시각에까지 적용한 것인데,
 *   persist()의 서버 전송은 fire-and-forget이라 **그게 도착하기 전에 load()가 돌면 서버엔 아직
 *   광고 보기 전의 옛 마감시각이 있다.** 그 이른 값을 채택하면서 광고 보는 동안 흐른 시간만큼
 *   깎인 것처럼 보였다 — 사장님 표현 그대로 "광고 시간을 깐" 결과다.
 *
 *   → 마감시각은 클램프하지 않는다. **로컬에 살아 있는 세션이 있으면 그게 이긴다.**
 *   남용 차단의 실제 근거는 `timedOut`(OR)과 하루 광고 횟수(useFocusExtendAdStore의 max 병합)이지
 *   마감시각이 아니다. 로컬을 지운 사용자는 어차피 timedOut을 물려받아 게이트에 걸린다.
 *   서버의 마감시각은 **로컬에 아무것도 없을 때만** 쓴다(기기 교체·재설치 후 이어받기).
 */
async function mergeServer(): Promise<void> {
  try {
    const server = await focusAllowanceApi.get(todayKey());
    const state = useFocusSessionStore.getState();
    const serverEndsAt = server.sessionEndsAt != null ? Date.parse(server.sessionEndsAt) : null;
    let timedOut = state.timedOut || server.timedOut;
    let endsAt = state.endsAt;
    // 로컬에 살아 있는 세션이 있으면 그대로 둔다(서버 값으로 절대 깎지 않는다 — 위 주석 참고).
    // 로컬이 비어 있을 때만 서버 값을 이어받되, 그것도 아직 안 지난 것만 쓴다.
    if (endsAt == null && serverEndsAt != null && Number.isFinite(serverEndsAt) && serverEndsAt > Date.now()) {
      endsAt = serverEndsAt;
    }
    if (timedOut && (endsAt == null || endsAt <= Date.now())) endsAt = null;
    // ⚠️ timedOut이 서 있어도 로컬 세션이 **살아 있으면** 지우지 않는다. 광고/크레딧으로 방금
    //   연장한 직후가 정확히 그 상태다(서버는 아직 timedOut=true인데 로컬은 이미 연장됨).
    //   예전엔 무조건 endsAt=null로 밀어서 연장이 통째로 사라질 수 있었다.
    if (endsAt != null && endsAt > Date.now()) timedOut = false;
    if (timedOut !== state.timedOut || endsAt !== state.endsAt) {
      useFocusSessionStore.setState({ date: todayKey(), endsAt, timedOut });
      AsyncStorage.setItem(STORAGE_KEYS.focusSession, JSON.stringify({ date: todayKey(), endsAt, timedOut })).catch(() => {});
    }
  } catch {
    // 오프라인/미인증 — 로컬 값으로 계속 간다.
  }
}

export const useFocusSessionStore = create<FocusSessionState>((set, get) => ({
  date: todayKey(),
  endsAt: null,
  timedOut: false,
  hydrated: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusSession);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<PersistedFocusSession>;
        // 🔴 2026-08-20 — 저장된 날짜가 오늘이 아니면 통째로 버린다(위 타입 주석 참고).
        //   날짜가 없는 구버전 저장값도 여기서 함께 걸러진다 — 그 값들이 정확히 이 버그의
        //   피해자이므로(영구 timedOut) 새 날짜로 초기화하는 것이 맞다.
        if (saved.date !== todayKey()) {
          set({ date: todayKey(), endsAt: null, timedOut: false, hydrated: true });
          persist({ date: todayKey(), endsAt: null, timedOut: false });
          await mergeServer();
          return;
        }
        const endsAt = typeof saved.endsAt === 'number' ? saved.endsAt : null;
        const timedOut = saved.timedOut === true;
        // 앱이 꺼져 있는 동안 마감시각이 지났으면, 그건 "시간이 다 된" 것이다 — 되살릴 세션은
        // 없지만 timedOut은 세워야 한다. 안 그러면 앱을 껐다 켜는 것만으로 광고 게이트를 피할 수 있다.
        if (endsAt != null && endsAt <= Date.now()) {
          set({ date: todayKey(), endsAt: null, timedOut: true, hydrated: true });
          persist({ date: todayKey(), endsAt: null, timedOut: true });
          return;
        }
        set({ date: todayKey(), endsAt, timedOut, hydrated: true });
        await mergeServer();
        return;
      }
    } catch {
      // 손상된 값이면 아래 기본값으로 폴백
    }
    // 🔴 2026-08-12 사장님 실기기 제보(iOS) — "앱 지웠다 다시 설치하니 포커스가 10분으로 리셋된다".
    //   여기가 **재설치 직후 경로**(로컬에 저장된 세션이 아예 없음)다. 예전엔 hydrated를 먼저 세우고
    //   서버 병합을 나중에 await 했는데, hydrated=true를 본 화면이 그 사이에 세션을 시작해버리면
    //   서버가 "오늘 이미 다 썼다(timedOut)"고 말하기 전에 **공짜 10분**이 나간다.
    //   = 앱을 지웠다 깔기만 하면 광고 3회 게이트를 무한히 우회할 수 있다(사장님이 막으라고 한 그것).
    //   → 로컬에 근거가 하나도 없는 이 경로에서만 **서버 답을 받은 뒤에** hydrated를 세운다.
    //   ⚠️ 오프라인에서 영원히 막히면 안 되므로(이 앱의 fail-open 원칙) 최대 3초만 기다린다.
    //     그 안에 못 받으면 일단 열어주고, 병합은 도착하는 대로 스토어에 반영된다.
    set({ date: todayKey(), endsAt: null, timedOut: false });
    await Promise.race([
      mergeServer(),
      new Promise<void>((resolve) => setTimeout(resolve, FRESH_INSTALL_MERGE_TIMEOUT_MS)),
    ]);
    set({ hydrated: true });
  },

  start: (durationMinutes) => {
    const next = { date: todayKey(), endsAt: Date.now() + durationMinutes * 60 * 1000, timedOut: false };
    set(next);
    persist(next);
  },

  extend: (minutes) => {
    // 남은 시간이 있으면 거기에 더하고, 없으면(타임아웃 직후 연장) 지금부터 센다.
    const base = Math.max(get().endsAt ?? 0, Date.now());
    const next = { date: todayKey(), endsAt: base + minutes * 60 * 1000, timedOut: false };
    set(next);
    persist(next);
  },

  markTimedOut: () => {
    const next = { date: todayKey(), endsAt: null, timedOut: true };
    set(next);
    persist(next);
  },

  stop: () => {
    const next = { date: todayKey(), endsAt: null, timedOut: false };
    set(next);
    persist(next);
  },
}));
