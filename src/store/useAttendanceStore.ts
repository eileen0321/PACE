import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';

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
    const today = todayStr();
    const s = get();
    if (s.lastCheckInDate === today) return { checkedIn: false, earned: 0 };

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
