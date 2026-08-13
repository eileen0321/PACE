import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';
import { focusAllowanceApi } from '../services/api/client';

// 2026-07-26 사용자 지시("매일 출석하기 — 매일 크레딧을 받으세요") — 하루 1회 앱을 열면 출석으로
// 인정하고 크레딧을 지급한다. useFlipStore의 credits(오늘 쉰 시간 기반, 자정마다 리셋)와는 별개
// 개념 — 출석 보너스는 안 써도 다음날로 이월되는 "적립 지갑"이라 여기서 독립적으로 관리하고,
// 실제 소비(Focus Session 한도 연장)는 overlay/index.tsx가 두 잔액(Flip 크레딧 + 출석 보너스)을
// 합산해서 처리한다.
const DAILY_CHECKIN_CREDITS = 5; // 2026-07-26 사용자 지시 — 출석 1회당 +5크레딧으로 확정(PACE_PROJECT_MANAGEMENT.md 참고)
const HISTORY_DAYS_KEPT = 30; // 이력 배열이 무한정 안 커지게 최근 30일만 보관(주간 위젯은 7일만 씀)

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 🔴 2026-08-13 발견 10 — 크레딧 지급 판정에 쓸 **신뢰 가능한 오늘**.
// 서버가 자기 시각으로 채운 값(FocusAllowanceResponse.serverToday)을 우선 쓰고, 오프라인이거나
// 구버전 서버면 로컬 날짜로 폴백한다. 표시용(주간 위젯/스트릭)은 로컬 날짜를 그대로 쓴다 —
// 사용자가 보는 달력은 자기 기기 기준이어야 자연스럽고, 거긴 크레딧이 걸리지 않는다.
async function trustedTodayStr(): Promise<string> {
  try {
    const res = await focusAllowanceApi.get(todayStr());
    if (typeof res.serverToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(res.serverToday)) {
      return res.serverToday;
    }
  } catch {
    // 오프라인/미인증 — 아래 폴백
  }
  return todayStr();
}

type Persisted = {
  lastCheckInDate: string | null;
  history: string[]; // 출석한 날짜(YYYY-MM-DD) 목록, 최근 HISTORY_DAYS_KEPT일만 보관
  bonusCredits: number;
};

type AttendanceState = {
  lastCheckInDate: string | null;
  history: string[];
  bonusCredits: number;
  loaded: boolean;
  // 2026-07-31 사용자 지적("출석 크레딧과 집중시간 다 됐다는 팝업이 동시에 나오면서 UI가 정리 안
  // 되어 보임") — 출석 축하 팝업(_layout.tsx, 루트)과 한도도달/Focus Session 연장 팝업(home.tsx,
  // 탭 트리)이 서로 다른 컴포넌트 트리라 조율이 전혀 없었다. 이 플래그를 공유 신호로 써서 출석
  // 팝업이 떠 있는 동안은 다른 팝업들이 렌더를 미루게 한다(출석 팝업이 항상 우선).
  celebrationVisible: boolean;
  setCelebrationVisible: (visible: boolean) => void;

  load: () => Promise<void>;
  /** 앱 부팅 시 1회 호출 — 오늘 아직 출석 안 했으면 체크인 처리 + 크레딧 지급, 했으면 no-op.
   *  {checkedIn:true}면 호출부(_layout.tsx)가 축하 팝업을 띄운다. */
  checkInIfNeeded: () => Promise<{ checkedIn: boolean; earned: number }>;
  /** Focus Session 한도 연장에 출석 보너스를 쓴다 — useFlipStore.spendCredits와 동일한 계약
   *  (보유량 초과 요청은 보유량만큼만 쓰고 실제 소비량 반환). */
  spendBonusCredits: (amount: number) => number;
};

function persist(s: Persisted) {
  AsyncStorage.setItem(STORAGE_KEYS.attendance, JSON.stringify(s)).catch(() => {});
}

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  lastCheckInDate: null,
  history: [],
  bonusCredits: 0,
  loaded: false,
  celebrationVisible: false,
  setCelebrationVisible: (visible) => set({ celebrationVisible: visible }),

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.attendance);
      const saved = raw ? (JSON.parse(raw) as Partial<Persisted>) : null;
      set({
        lastCheckInDate: saved?.lastCheckInDate ?? null,
        history: saved?.history ?? [],
        bonusCredits: saved?.bonusCredits ?? 0,
        loaded: true,
      });
    } catch {
      set({ lastCheckInDate: null, history: [], bonusCredits: 0, loaded: true });
    }
  },

  checkInIfNeeded: async () => {
    // load()가 아직 안 끝났으면(레이스) 먼저 기다린다 — AsyncStorage 값을 못 본 채 중복 지급하는 걸 방지.
    if (!get().loaded) await get().load();
    // 🔴 2026-08-13 발견 10 — 예전엔 여기서 기기 로컬 날짜(todayStr)만 봤다. 그래서 **설정에서 날짜를
    //   N번 바꾸면 5N 크레딧**이 그대로 적립됐고, 그 크레딧은 포커스 세션 연장에 광고 대신 쓸 수 있어
    //   결과적으로 **광고를 한 번도 안 보고 무제한 연장**이 가능했다. 광고 3회 한도는 서버
    //   sanitizeDate로 막았지만(f7ae3df) 이 경로가 그대로 남아 있었다.
    //   → 서버가 내려주는 **신뢰 가능한 오늘**(FocusAllowanceResponse.serverToday, 클라이언트가 보낸
    //     날짜와 무관하게 서버 시각으로 채워짐)을 우선 쓴다. 새 엔드포인트를 파지 않고, 이미 매 부팅
    //     호출되는 응답에 얹은 값을 재사용한다.
    //   ⚠️ 오프라인/구버전 서버면 로컬 날짜로 폴백한다 — 이 앱의 fail-open 원칙대로,
    //     비행기 안에서 출석이 안 되면 정상 사용자가 손해다. 우회 가능성보다 사용성을 택한다
    //     (온라인이 되는 순간부터는 서버 날짜가 지배한다).
    const today = await trustedTodayStr();
    const s = get();
    if (s.lastCheckInDate === today) return { checkedIn: false, earned: 0 };
    // 단조 가드 — 날짜를 **뒤로** 돌린 뒤 다시 앞으로 오는 식의 반복 수령을 막는다.
    // 이미 받은 날짜보다 크지 않으면 지급하지 않는다(같은 날 재실행은 위 조건에서 이미 걸린다).
    if (s.lastCheckInDate && today <= s.lastCheckInDate) return { checkedIn: false, earned: 0 };

    const history = [...s.history, today].slice(-HISTORY_DAYS_KEPT);
    const bonusCredits = s.bonusCredits + DAILY_CHECKIN_CREDITS;
    set({ lastCheckInDate: today, history, bonusCredits });
    persist({ lastCheckInDate: today, history, bonusCredits });
    return { checkedIn: true, earned: DAILY_CHECKIN_CREDITS };
  },

  spendBonusCredits: (amount) => {
    const s = get();
    const spent = Math.max(0, Math.min(Math.floor(amount), s.bonusCredits));
    if (spent === 0) return 0;
    const bonusCredits = s.bonusCredits - spent;
    set({ bonusCredits });
    persist({ lastCheckInDate: s.lastCheckInDate, history: s.history, bonusCredits });
    return spent;
  },
}));

// 설정 화면의 "주간 출석" 위젯용 — 오늘 포함 최근 7일을 오래된 순으로 반환.
// 2026-07-26 감사 발견 — 요일 라벨이 언어 설정과 무관하게 하드코딩된 한글 배열이었다. 이 파일은
// 훅이 아니라 순수 함수라 t()를 직접 쓸 수 없으므로, dayIndex(0=일~6=토, Date.getDay()와 동일)만
// 반환하고 실제 문자열 매핑은 호출부(컴포넌트, useTranslation 가능)가 stats.daySun..daySat 키로 한다.
export function getLast7Days(history: string[]): { date: string; dayIndex: number; attended: boolean; isToday: boolean }[] {
  const today = todayStr();
  const days: { date: string; dayIndex: number; attended: boolean; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;
    days.push({
      date: dateStr,
      dayIndex: d.getDay(),
      attended: history.includes(dateStr),
      isToday: dateStr === today,
    });
  }
  return days;
}

// 2026-07-26 — "N일 연속" 스트릭 표시용. 오늘부터 거꾸로 하루씩 내려가며 이력에 있는 날만 센다 —
// 하루라도 빠지면 그 지점에서 멈춘다(연속이 아니므로). 오늘 아직 체크인 전이어도(이론상 불가능 —
// _layout.tsx가 부팅마다 checkInIfNeeded를 부르므로 항상 먼저 기록됨) 자연스럽게 0으로 끊긴다.
export function getCurrentStreak(history: string[]): number {
  const set = new Set(history);
  let streak = 0;
  const d = new Date();
  while (true) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (!set.has(`${y}-${m}-${day}`)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
