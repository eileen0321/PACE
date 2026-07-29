import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './storage/keys';
import { getUsageInsightData, getTodayUsageMinutes } from '../database/repositories/statsRepository';
import { translate, resolveSystemLocale, type TranslationKey } from './i18n';
import { useSettingsStore } from '../store/useSettingsStore';

// 2026-07-28 사장님 지시("몇시에 잠들었습니다 말고 다른 노티로 만드는건 어때 — 어제 마지막으로
// 몇시까지 봤다, 오늘은 어제보다 평균 얼마를 더 보고 있다 이런 랜덤 노티 / 재미있는걸로 / json
// 만들고 랜덤하게 보여주면") — 하루 1회, 그날 실제로 "적용 가능한"(필요한 데이터가 있는) 템플릿
// 중에서만 랜덤으로 하나 골라 로컬 알림으로 띄운다. 데이터가 없는 템플릿(예: 어제 시청 기록이
// 아예 없는 신규 유저)은 후보에서 자동 제외 — "가짜 데이터로 채우지 말라"는 기존 원칙과 동일.
type TemplateId =
  | 'usageInsightYesterdayLastWatched1'
  | 'usageInsightYesterdayLastWatched2'
  | 'usageInsightTodayMore1'
  | 'usageInsightTodayMore2'
  | 'usageInsightTodayLess1'
  | 'usageInsightTodayLess2';

type TemplateNeeds = 'yesterdayLastWatched' | 'todayMoreThanAvg' | 'todayLessThanAvg';

const TEMPLATES: { id: TemplateId; needs: TemplateNeeds }[] = [
  { id: 'usageInsightYesterdayLastWatched1', needs: 'yesterdayLastWatched' },
  { id: 'usageInsightYesterdayLastWatched2', needs: 'yesterdayLastWatched' },
  { id: 'usageInsightTodayMore1', needs: 'todayMoreThanAvg' },
  { id: 'usageInsightTodayMore2', needs: 'todayMoreThanAvg' },
  { id: 'usageInsightTodayLess1', needs: 'todayLessThanAvg' },
  { id: 'usageInsightTodayLess2', needs: 'todayLessThanAvg' },
];

// 두 그룹(오늘 더/덜)이 동시에 후보가 될 순 없지만(같은 조건의 반대), 오탐 방지로 최소 5분 차이는
// 나야 "의미 있는 차이"로 본다(1~2분 차이로 매번 뜨면 의미 없는 노이즈).
const MEANINGFUL_DIFF_MINUTES = 5;

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const period = hours < 12 ? 'AM' : 'PM';
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function currentLocale() {
  const language = useSettingsStore.getState().settings.language;
  return language === 'system' ? resolveSystemLocale() : language;
}

// 2026-07-29 사장님 지시 — "잠들었습니다" 배너 대신, 이 랜덤 인사이트를 홈 인앱 배너로도 띄운다.
// 노티(maybeShowUsageInsight)와 같은 후보 로직을 공유하도록 배너용 공개 함수로 노출한다. 그날
// 적용 가능한(데이터 있는) 템플릿이 하나도 없으면 null(배너 안 뜸).
export async function getRandomInsightMessage(userId: string): Promise<string | null> {
  try {
    return await buildCandidateMessage(userId);
  } catch {
    return null;
  }
}

async function buildCandidateMessage(userId: string): Promise<string | null> {
  const [raw, todayTotalMinutes] = await Promise.all([
    getUsageInsightData(userId),
    getTodayUsageMinutes(userId),
  ]);
  const avg = raw.avgMinutesExcludingToday;
  const diffFromAvg = avg != null ? Math.round(todayTotalMinutes - avg) : null;

  const eligible: { id: TemplateId; params: Record<string, string | number> }[] = [];
  if (raw.yesterdayLastWatchedIso) {
    const time = formatLocalTime(raw.yesterdayLastWatchedIso);
    TEMPLATES.filter((t) => t.needs === 'yesterdayLastWatched').forEach((t) =>
      eligible.push({ id: t.id, params: { time } })
    );
  }
  if (diffFromAvg != null && diffFromAvg >= MEANINGFUL_DIFF_MINUTES) {
    TEMPLATES.filter((t) => t.needs === 'todayMoreThanAvg').forEach((t) =>
      eligible.push({ id: t.id, params: { diff: diffFromAvg } })
    );
  } else if (diffFromAvg != null && diffFromAvg <= -MEANINGFUL_DIFF_MINUTES && todayTotalMinutes > 0) {
    TEMPLATES.filter((t) => t.needs === 'todayLessThanAvg').forEach((t) =>
      eligible.push({ id: t.id, params: { diff: Math.abs(diffFromAvg) } })
    );
  }

  if (!eligible.length) return null;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  return translate(currentLocale(), pick.id as TranslationKey, pick.params);
}

// 하루 1회만(오늘 이미 보여줬으면 스킵). 실패는 조용히 무시 — 부가 기능이라 실패해도 앱 사용에 지장 없어야 함.
export async function maybeShowUsageInsight(userId: string, fireNotification: (title: string, body: string) => Promise<void>): Promise<void> {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastShown = await AsyncStorage.getItem(STORAGE_KEYS.lastUsageInsightShownDate);
    if (lastShown === todayStr) return;
    const message = await buildCandidateMessage(userId);
    if (!message) return;
    await AsyncStorage.setItem(STORAGE_KEYS.lastUsageInsightShownDate, todayStr);
    const locale = currentLocale();
    await fireNotification(translate(locale, 'home.usageInsightTitle'), message);
  } catch {
    // 조용히 무시
  }
}
