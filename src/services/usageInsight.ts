import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './storage/keys';
import { getUsageInsightData, getTodayUsageMinutes } from '../database/repositories/statsRepository';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveSystemLocale } from './i18n';
import { insightApi, type InsightBundle } from './api/client';
import { STAT_TEMPLATES, HEALING_ITEMS, QUOTE_ITEMS, TIP_ITEMS, type FlatContent } from './insightContent';

// 2026-07-28 사장님 지시("몇시에 잠들었습니다 말고 다른 노티로 만드는건 어때") → 2026-07-29 확장
// 지시("배너 뜨는 조건도 랜덤으로, 문구도 신조어/힐링/명언까지 훨씬 다양하게") — 사용 습관 통계
// (데이터 있을 때만) + 항상 후보인 힐링/명언/가이드 문구 중에서 랜덤으로 하나 뽑아 홈 배너에
// 보여준다("몇시에 잠들었어요"는 이 풀에서 의도적으로 제외 — 그건 별개 기능인 수면 감지 세션 종료
// 로직 자체와는 무관, useSleepInsightStore는 손대지 않음).
// 2026-08-01 — 신조어 카테고리는 제거(유행어라 금방 낡아 보인다는 사용자 지적). 손짓/블루투스
// 리모컨처럼 몰라서 안 쓰는 기능을 알려주는 가이드 문구(tip)를 새로 추가. "화면 속 것 vs 곁에 있는
// 것" 대비 문구(spark)도 한때 추가했으나 "너무 교육적이다, 담배 광고처럼 후회시키는 식이라 위화감을
// 준다"는 사용자 지적으로 카테고리째 폐기(insightContent.ts 참고).
// 2026-08-01 — 사용자 지적("왜 계속 같은 것만 띄우냐고", "랜덤으로 바꿔줘야 할거 아냐") — 예전엔
// 하루 1회 뽑아 AsyncStorage에 캐시해 그날은 몇 번을 다시 열어도 똑같은 문구만 보였다. 캐시 없이
// 홈 탭에 포커스되거나 앱이 포그라운드로 돌아올 때마다(useFocusEffect + AppState, home.tsx) 매번
// 새로 랜덤 하나를 뽑도록 단순화.
// 2026-08-01 사용자 지시("출시전에" 백엔드로 이전) — 문구 풀 자체를 백엔드(/insights)에서 받아오게
// 바꿨다. 예전엔 이 파일이 insightContent.ts의 하드코딩된 배열을 "진실의 원천"으로 썼는데, 그러면
// 문구 하나 고칠 때마다 앱스토어 재배포(특히 iOS 심사 대기)가 필요했다. 이제 문구 풀 자체를 하루
// 한 번 백엔드에서 받아 AsyncStorage에 캐시해두고(오프라인/서버 다운 시에도 안 죽게), 그 캐시(없으면
// insightContent.ts 로컬 폴백) 안에서 매번 랜덤으로 하나를 뽑는다 — "랜덤으로 매번 바뀌어야 한다"는
// 이전 지적과 "백엔드에서 갱신 가능해야 한다"는 지적을 동시에 만족.

type StatCategory = 'yesterdayLastWatched' | 'todayMoreThanAvg' | 'todayLessThanAvg';
type Source = 'stat' | 'healing' | 'quote' | 'tip';

type Params = { time?: string; diff?: number };

const MEANINGFUL_DIFF_MINUTES = 5;

const LOCAL_FALLBACK_BUNDLE: InsightBundle = {
  healing: HEALING_ITEMS,
  quote: QUOTE_ITEMS,
  tip: TIP_ITEMS,
  statYesterdayLastWatched: STAT_TEMPLATES.yesterdayLastWatched,
  statTodayMoreThanAvg: STAT_TEMPLATES.todayMoreThanAvg,
  statTodayLessThanAvg: STAT_TEMPLATES.todayLessThanAvg,
};

// 앱 실행 중 반복 요청을 피하기 위한 인메모리 캐시(콜드 스타트마다 AsyncStorage는 1번만 읽음).
let memoryBundle: InsightBundle | null = null;
let memoryBundleDate: string | null = null;
let inFlight: Promise<InsightBundle> | null = null;

async function getBundle(): Promise<InsightBundle> {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (memoryBundle && memoryBundleDate === todayStr) return memoryBundle;

  if (!inFlight) {
    inFlight = (async () => {
      try {
        const cachedRaw = await AsyncStorage.getItem(STORAGE_KEYS.insightBundleCache);
        const cachedDate = await AsyncStorage.getItem(STORAGE_KEYS.insightBundleCacheDate);
        if (cachedRaw && cachedDate === todayStr) {
          const bundle = JSON.parse(cachedRaw) as InsightBundle;
          memoryBundle = bundle;
          memoryBundleDate = todayStr;
          return bundle;
        }

        // 오늘자 캐시가 없으면(날짜가 바뀌었거나 최초 실행) 백엔드에서 새로 받는다.
        const fresh = await insightApi.getBundle();
        memoryBundle = fresh;
        memoryBundleDate = todayStr;
        await AsyncStorage.setItem(STORAGE_KEYS.insightBundleCache, JSON.stringify(fresh));
        await AsyncStorage.setItem(STORAGE_KEYS.insightBundleCacheDate, todayStr);
        return fresh;
      } catch {
        // 네트워크 실패 등 — 어제까지의 캐시가 있으면(날짜는 안 맞아도) 그거라도 재사용, 없으면
        // 앱에 번들된 로컬 폴백(insightContent.ts)으로 절대 배너가 안 죽게 한다.
        try {
          const staleRaw = await AsyncStorage.getItem(STORAGE_KEYS.insightBundleCache);
          if (staleRaw) {
            const bundle = JSON.parse(staleRaw) as InsightBundle;
            memoryBundle = bundle;
            memoryBundleDate = todayStr;
            return bundle;
          }
        } catch {
          // 파싱 실패 — 아래 폴백으로.
        }
        memoryBundle = LOCAL_FALLBACK_BUNDLE;
        memoryBundleDate = todayStr;
        return LOCAL_FALLBACK_BUNDLE;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

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

function fillTemplate(text: string, params?: Params): string {
  if (!params) return text;
  let out = text;
  if (params.time != null) out = out.replace(/\{\{time\}\}/g, params.time);
  if (params.diff != null) out = out.replace(/\{\{diff\}\}/g, String(params.diff));
  return out;
}

function poolFor(bundle: InsightBundle, source: Source, statCategory: StatCategory | undefined): FlatContent[] {
  if (source === 'stat') {
    if (statCategory === 'yesterdayLastWatched') return bundle.statYesterdayLastWatched;
    if (statCategory === 'todayMoreThanAvg') return bundle.statTodayMoreThanAvg;
    if (statCategory === 'todayLessThanAvg') return bundle.statTodayLessThanAvg;
    return [];
  }
  if (source === 'healing') return bundle.healing;
  if (source === 'tip') return bundle.tip;
  return bundle.quote;
}

// 홈 배너용 — 호출할 때마다 매번 새로 랜덤 하나를 뽑는다(문구 풀 자체는 하루 단위로 캐시).
export async function getTodaysInsightMessage(userId: string): Promise<string | null> {
  try {
    const [bundle, raw, todayTotalMinutes] = await Promise.all([
      getBundle(),
      getUsageInsightData(userId),
      getTodayUsageMinutes(userId),
    ]);
    const avg = raw.avgMinutesExcludingToday;
    const diffFromAvg = avg != null ? Math.round(todayTotalMinutes - avg) : null;

    // 후보 풀: 통계 기반(데이터 있을 때만) + 항상 후보인 힐링/명언/가이드.
    const candidates: { source: Source; statCategory?: StatCategory; index: number; params?: Params }[] = [];
    if (raw.yesterdayLastWatchedIso && bundle.statYesterdayLastWatched.length) {
      const time = formatLocalTime(raw.yesterdayLastWatchedIso);
      bundle.statYesterdayLastWatched.forEach((_, i) =>
        candidates.push({ source: 'stat', statCategory: 'yesterdayLastWatched', index: i, params: { time } })
      );
    }
    if (diffFromAvg != null && diffFromAvg >= MEANINGFUL_DIFF_MINUTES) {
      bundle.statTodayMoreThanAvg.forEach((_, i) =>
        candidates.push({ source: 'stat', statCategory: 'todayMoreThanAvg', index: i, params: { diff: diffFromAvg } })
      );
    } else if (diffFromAvg != null && diffFromAvg <= -MEANINGFUL_DIFF_MINUTES && todayTotalMinutes > 0) {
      bundle.statTodayLessThanAvg.forEach((_, i) =>
        candidates.push({ source: 'stat', statCategory: 'todayLessThanAvg', index: i, params: { diff: Math.abs(diffFromAvg) } })
      );
    }
    bundle.healing.forEach((_, i) => candidates.push({ source: 'healing', index: i }));
    bundle.quote.forEach((_, i) => candidates.push({ source: 'quote', index: i }));
    bundle.tip.forEach((_, i) => candidates.push({ source: 'tip', index: i }));
    if (!candidates.length) return null;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const pool = poolFor(bundle, chosen.source, chosen.statCategory);
    const item = pool[chosen.index] ?? pool[0];
    if (!item) return null;
    const locale = currentLocale() === 'ko' ? 'ko' : 'en';
    return fillTemplate(locale === 'ko' ? item.ko : item.en, chosen.params);
  } catch {
    return null;
  }
}
