import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../services/storage/keys';
import { getLatestSleepDetectedSession } from '../database/repositories/sessionsRepository';
import type { TranslationKey } from '../services/i18n';

// 수면 감지(스펙 §1-B) 다음날 요약 — "새벽 1시 23분에 잠드셨습니다" 배너. 네이티브
// (PaceOverlayService.kt)가 무진동 감지로 세션을 sleep_detected로 종료하면, 다음에 앱을 열 때
// (대개 아침) 홈 화면이 이 스토어의 check()를 불러 아직 안 보여준 세션이면 배너를 띄운다.
type SleepInsightState = {
  endedAt: string | null; // ISO — 표시 중인 인사이트의 세션 종료 시각(=잠든 시각으로 근사)
  sessionId: string | null;

  /** 홈 화면 마운트 시 호출 — 최신 sleep_detected 세션을 조회해 아직 안 본 것이면 노출. */
  check: (userId: string) => Promise<void>;
  /** 사용자가 배너를 닫으면 다시 안 뜨게 "봤음"으로 기록. */
  dismiss: () => Promise<void>;
};

export const useSleepInsightStore = create<SleepInsightState>((set, get) => ({
  endedAt: null,
  sessionId: null,

  check: async (userId: string) => {
    try {
      const session = await getLatestSleepDetectedSession(userId);
      if (!session?.endedAt) return;
      const lastSeenId = await AsyncStorage.getItem(STORAGE_KEYS.lastSeenSleepInsightSessionId);
      if (lastSeenId === session.id) return; // 이미 보여준 세션 — 다시 안 띄움
      set({ endedAt: session.endedAt, sessionId: session.id });
    } catch {
      // 조회 실패는 조용히 무시 — 인사이트는 부가 기능이라 실패해도 앱 사용에 지장 없어야 함
    }
  },

  dismiss: async () => {
    const { sessionId } = get();
    if (sessionId) {
      await AsyncStorage.setItem(STORAGE_KEYS.lastSeenSleepInsightSessionId, sessionId).catch(() => {});
    }
    set({ endedAt: null, sessionId: null });
  },
}));

// "새벽 1시 23분에 잠드셨습니다" 포맷 — 사용자 원 스펙 문구 그대로.
// 2026-07-26 감사 발견 — 이 함수가 언어 설정과 무관하게 항상 한국어 문자열을 직접 조립해
// 반환했다(영어 모드에서도 그대로 노출). 순수 함수라 t()를 못 쓰므로, 호출부(home.tsx, 컴포넌트라
// useTranslation 가능)의 t를 인자로 받아 로케일에 맞는 문구로 조립한다.
export function formatSleepInsight(endedAtIso: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const d = new Date(endedAtIso);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const period = hours < 12 ? '새벽' : hours < 18 ? '오후' : '저녁';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const time = `${displayHour}:${paddedMinutes} ${hours < 12 ? 'AM' : 'PM'}`;
  return t('home.sleepInsightMessage', { time, period, hour: displayHour, minute: minutes });
}
