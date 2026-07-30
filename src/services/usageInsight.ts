import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './storage/keys';
import { getUsageInsightData, getTodayUsageMinutes } from '../database/repositories/statsRepository';
import { translate, resolveSystemLocale } from './i18n';
import { useSettingsStore } from '../store/useSettingsStore';
import { STAT_TEMPLATES, SLANG_ITEMS, HEALING_ITEMS, QUOTE_ITEMS, type FlatContent } from './insightContent';

// 2026-07-28 사장님 지시("몇시에 잠들었습니다 말고 다른 노티로 만드는건 어때") → 2026-07-29 확장
// 지시("배너 뜨는 조건도 랜덤으로, 문구도 신조어/힐링/명언까지 훨씬 다양하게") — 하루 1회, 사용
// 습관 통계(데이터 있을 때만) + 항상 후보인 신조어/힐링/명언 중에서 랜덤으로 하나 뽑아 노티와 홈
// 배너 둘 다 같은 걸 보여준다("몇시에 잠들었어요"는 이 풀에서 의도적으로 제외 — 그건 별개 기능인
// 수면 감지 세션 종료 로직 자체와는 무관, useSleepInsightStore는 손대지 않음).

type StatCategory = 'yesterdayLastWatched' | 'todayMoreThanAvg' | 'todayLessThanAvg';
type Source = 'stat' | 'slang' | 'healing' | 'quote';

type CachedPick = {
  date: string;
  source: Source;
  statCategory?: StatCategory;
  index: number;
  params?: { time?: string; diff?: number };
};

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

function fillTemplate(text: string, params?: CachedPick['params']): string {
  if (!params) return text;
  let out = text;
  if (params.time != null) out = out.replace(/\{\{time\}\}/g, params.time);
  if (params.diff != null) out = out.replace(/\{\{diff\}\}/g, String(params.diff));
  return out;
}

function pickFrom(source: Source, statCategory: StatCategory | undefined, index: number, locale: 'en' | 'ko', params?: CachedPick['params']): string {
  let pool: FlatContent[];
  if (source === 'stat' && statCategory) pool = STAT_TEMPLATES[statCategory];
  else if (source === 'slang') pool = SLANG_ITEMS;
  else if (source === 'healing') pool = HEALING_ITEMS;
  else pool = QUOTE_ITEMS;
  const item = pool[index] ?? pool[0];
  const text = locale === 'ko' ? item.ko : item.en;
  return fillTemplate(text, params);
}

// 오늘자 뽑기가 이미 있으면 그걸 재사용(캐시), 없으면 새로 뽑아서 저장.
async function getOrPickToday(userId: string): Promise<CachedPick | null> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const cachedRaw = await AsyncStorage.getItem(STORAGE_KEYS.todaysInsightPick);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as CachedPick;
      if (cached.date === todayStr) return cached;
    } catch {
      // 파싱 실패 — 아래에서 새로 뽑음
    }
  }

  const [raw, todayTotalMinutes] = await Promise.all([
    getUsageInsightData(userId),
    getTodayUsageMinutes(userId),
  ]);
  const avg = raw.avgMinutesExcludingToday;
  const diffFromAvg = avg != null ? Math.round(todayTotalMinutes - avg) : null;

  // 후보 풀: 통계 기반(데이터 있을 때만) + 항상 후보인 신조어/힐링/명언.
  const candidates: { source: Source; statCategory?: StatCategory; index: number; params?: CachedPick['params'] }[] = [];
  if (raw.yesterdayLastWatchedIso) {
    const time = formatLocalTime(raw.yesterdayLastWatchedIso);
    STAT_TEMPLATES.yesterdayLastWatched.forEach((_, i) =>
      candidates.push({ source: 'stat', statCategory: 'yesterdayLastWatched', index: i, params: { time } })
    );
  }
  if (diffFromAvg != null && diffFromAvg >= MEANINGFUL_DIFF_MINUTES) {
    STAT_TEMPLATES.todayMoreThanAvg.forEach((_, i) =>
      candidates.push({ source: 'stat', statCategory: 'todayMoreThanAvg', index: i, params: { diff: diffFromAvg } })
    );
  } else if (diffFromAvg != null && diffFromAvg <= -MEANINGFUL_DIFF_MINUTES && todayTotalMinutes > 0) {
    STAT_TEMPLATES.todayLessThanAvg.forEach((_, i) =>
      candidates.push({ source: 'stat', statCategory: 'todayLessThanAvg', index: i, params: { diff: Math.abs(diffFromAvg) } })
    );
  }
  SLANG_ITEMS.forEach((_, i) => candidates.push({ source: 'slang', index: i }));
  HEALING_ITEMS.forEach((_, i) => candidates.push({ source: 'healing', index: i }));
  QUOTE_ITEMS.forEach((_, i) => candidates.push({ source: 'quote', index: i }));

  if (!candidates.length) return null;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  const pick: CachedPick = { date: todayStr, ...chosen };
  await AsyncStorage.setItem(STORAGE_KEYS.todaysInsightPick, JSON.stringify(pick));
  return pick;
}

// 홈 배너용 — 오늘의 인사이트 텍스트를 반환(뜨는 조건: 수면 감지와 무관, 항상 하루 1번 대상).
export async function getTodaysInsightMessage(userId: string): Promise<string | null> {
  try {
    const pick = await getOrPickToday(userId);
    if (!pick) return null;
    const locale = currentLocale() === 'ko' ? 'ko' : 'en';
    return pickFrom(pick.source, pick.statCategory, pick.index, locale, pick.params);
  } catch {
    return null;
  }
}

// 노티용 — 하루 1회만(오늘 이미 노티로 보여줬으면 스킵). 배너와 같은 오늘자 뽑기를 공유한다.
export async function maybeShowUsageInsight(userId: string, fireNotification: (title: string, body: string) => Promise<void>): Promise<void> {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastShown = await AsyncStorage.getItem(STORAGE_KEYS.lastUsageInsightShownDate);
    if (lastShown === todayStr) return;
    const message = await getTodaysInsightMessage(userId);
    if (!message) return;
    await AsyncStorage.setItem(STORAGE_KEYS.lastUsageInsightShownDate, todayStr);
    const locale = currentLocale();
    await fireNotification(translate(locale, 'home.usageInsightTitle'), message);
  } catch {
    // 조용히 무시
  }
}
