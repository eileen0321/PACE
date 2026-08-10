import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { STORAGE_KEYS } from '../storage/keys';
import type { FlatContent } from '../insightContent';

// "ko-KR,ko;q=0.9,en;q=0.8" 형태. 백엔드는 앞쪽 태그의 지역 코드(KR)만 읽는다.
function acceptLanguageTag(): string {
  try {
    const loc = Localization.getLocales()[0];
    const lang = (loc?.languageCode || 'en').toLowerCase();
    const tag = loc?.languageTag || lang;
    return lang === 'en' ? `${tag},en;q=0.9` : `${tag},${lang};q=0.9,en;q=0.8`;
  } catch {
    return 'en-US,en;q=0.9';
  }
}

// 커스텀 백엔드 REST 클라이언트 (zen-master src/common/services/api.ts 패턴 이식).
// Supabase 대신 자체 API 서버 + JWT를 쓰기로 결정 — PACE_ARCHITECTURE.md "확정 결정" 참고.
export const API_BASE_URL = __DEV__
  ? process.env.EXPO_PUBLIC_API_BASE_URL_DEV || 'http://localhost:8080'
  : process.env.EXPO_PUBLIC_API_BASE_URL || '';

// 2026-08-01 사장님 지시(Shorts HOT) — 오버레이 P 메뉴는 유튜브를 벗어나지 않는 네이티브 창이라
// RN 브릿지 없이 직접 백엔드를 호출해야 한다(Saved/Favorite이 SQLite를 직접 여는 것과 동일 이유).
// baseUrl은 안 바뀌므로 모듈 로드 시 1회, 토큰은 값이 바뀔 때마다 캐시.
if (Platform.OS === 'android' && API_BASE_URL) {
  try {
    require('../../../modules/pace-overlay').PaceOverlay?.cacheApiBaseUrl(API_BASE_URL);
    // 2026-08-10 — 쇼츠 검색은 Vercel 프록시(별개 호스트)를 치므로 그 주소도 같이 밀어준다.
    const proxy = require('./youtube').YOUTUBE_PROXY_URL;
    if (proxy) require('../../../modules/pace-overlay').PaceOverlay?.cacheProxyBaseUrl(proxy);
  } catch {
    // 네이티브 미링크(Dev Client 빌드 전) — 조용히 무시.
  }
}
function cacheAuthTokenNative(token: string | null) {
  if (Platform.OS !== 'android') return;
  try {
    require('../../../modules/pace-overlay').PaceOverlay?.cacheAuthToken(token ?? '');
  } catch {
    // 네이티브 미링크 — 조용히 무시.
  }
}

let cachedToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  cachedToken = await AsyncStorage.getItem(STORAGE_KEYS.authToken);
  // 콜드 스타트 복원 경로 — setToken()을 거치지 않고 여기서 처음 채워지는 경우 네이티브 캐시가
  // 비어있을 수 있어 여기서도 동기화(오버레이가 로그인 세션 복원 전에 먼저 SavedList/ShortsHot을
  // 열 수 있는 타이밍 문제 방지).
  if (cachedToken) cacheAuthTokenNative(cachedToken);
  return cachedToken;
}

export async function setToken(token: string): Promise<void> {
  cachedToken = token;
  cacheAuthTokenNative(token);
  await AsyncStorage.setItem(STORAGE_KEYS.authToken, token);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  cacheAuthTokenNative(null);
  await AsyncStorage.removeItem(STORAGE_KEYS.authToken);
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean; // true면 Authorization 헤더 부착 (기본 true)
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  // 2026-08-05 — Accept-Language를 붙인다. 백엔드 ShortsHotController는 country 파라미터가 없을 때
  // 이 헤더의 지역 코드로 폴백하도록 짜여 있는데, RN fetch는 이 헤더를 자동으로 안 붙여서 그 폴백이
  // **한 번도 동작한 적이 없었다**(국가를 못 정해 US=영어 목록으로 떨어졌다). 서버가 이미 기대하는
  // 신호를 실제로 보내주는 것뿐이라 다른 엔드포인트에 영향은 없다.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': acceptLanguageTag(),
  };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new Error('UNAUTHORIZED');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API_ERROR ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type AuthResult = {
  token: string;
  userId: string;
  email: string | null;
  name: string | null;
  isPremium: boolean;
};

export const authApi = {
  loginWithGoogleIdToken: (idToken: string) =>
    request<AuthResult>('/auth/google', { method: 'POST', body: { idToken }, auth: false }),
  loginWithAppleIdToken: (identityToken: string, name?: string, authorizationCode?: string) =>
    request<AuthResult>('/auth/apple', { method: 'POST', body: { identityToken, name, authorizationCode }, auth: false }),
  loginAsGuest: (deviceId: string) =>
    request<AuthResult>('/auth/guest', { method: 'POST', body: { deviceId }, auth: false }),
  refresh: () => request<{ token: string }>('/auth/refresh', { method: 'POST' }),
  // Apple 5.1.1(v) — 계정을 만들 수 있으면 앱 안에서 삭제도 가능해야 함. 백엔드는 FK ON DELETE
  // CASCADE로 세션/설정까지 함께 지운다(AuthController.deleteAccount 참고, 단순 비활성화 아님).
  deleteAccount: () => request<void>('/auth/account', { method: 'DELETE' }),
};

// 🔴 2026-08-10 — 무료 Focus 허용량의 서버측 진실원천(backend V7__focus_allowance.sql).
// 로컬(안드 prefs / iOS AsyncStorage)만으로는 앱을 지웠다 깔면 통째로 초기화돼서 "무료 10분 +
// 광고 5분"을 무한 반복할 수 있었다. 게스트도 /auth/guest로 계정이 있으므로 비로그인도 보호된다.
export type FocusAllowance = {
  date: string;                 // YYYY-MM-DD (클라이언트 로컬 날짜)
  adExtendCount: number;
  timedOut: boolean;
  sessionEndsAt: string | null; // ISO8601(UTC)
};

export const focusAllowanceApi = {
  get: (date: string) => request<FocusAllowance>(`/focus-allowance?date=${encodeURIComponent(date)}`),
  // 서버는 덮어쓰지 않고 병합한다(카운트 max, timedOut OR) — 재설치 후 올라온 0이 기록을 못 지운다.
  sync: (body: { date: string; adExtendCount: number; timedOut: boolean; sessionEndsAt: string | null }) =>
    request<FocusAllowance>('/focus-allowance/sync', { method: 'POST', body }),
};

export type SessionSyncItem = {
  id: string;
  platformApp: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  videosWatched: number;
  autoNextUsed: boolean;
  status: string | null;
};

export const statsApi = {
  // ⚠️ 백엔드 StatsController는 /stats/sync에 있다(계획 단계에서 jlpt식 /stats/sessions을
  // /stats/sync로 개명했는데 클라이언트가 갱신되지 않아 어긋나 있었다 — 2026-07-18 정합화).
  pushSessions: (sessions: SessionSyncItem[]) => request<{ synced: number }>('/stats/sync', { method: 'POST', body: { sessions } }),
};

export type SettingsPayload = {
  autoNext: boolean;
  sleepTimerMinutes: number | null;
  dailyLimitMinutes: number;
  breakIntervalMinutes: number;
  preSessionBreathing: boolean;
  appShields: Record<string, unknown>;
  theme: string;
  language: string;
};

export const settingsApi = {
  getSettings: () => request<SettingsPayload>('/settings'),
  updateSettings: (patch: Partial<SettingsPayload>) => request<SettingsPayload>('/settings', { method: 'PUT', body: patch }),
};

// 2026-08-01 — 오버레이 P 메뉴 "Shorts HOT". Android는 네이티브(ShortsHotStore.kt)가 이 엔드포인트를
// 직접 호출하고, iOS는 이 RN 클라이언트로 같은 백엔드를 재사용한다(백엔드/데이터는 공용, UI만 플랫폼별).
export type ShortsHotVideo = {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
};
// 백엔드 curated 카테고리(Android ShortsHotStore.CATEGORIES와 동일).
export const SHORTS_HOT_CATEGORIES = ['all', 'music', 'gaming', 'comedy', 'entertainment', 'pets'] as const;

// 2026-08-05 사장님 실기기 확인 — 쇼츠 HOT 리스트가 **전부 영어 + 베트남어**였다(한국어 0건).
// 백엔드(ShortsHotController)는 국가를 두 경로로 받는다: ①`country` 파라미터 ②`Accept-Language` 폴백.
// 그런데 앱은 ①을 아예 안 보냈고, ②도 도착하지 않았다 — 위 request()가 붙이는 헤더는
// Content-Type과 Authorization뿐이라 RN fetch에 Accept-Language가 없다. 그래서 백엔드가 국가를
// 정하지 못해 US로 폴백했고, 그게 영어 목록의 정체다(a6002c1의 KR/JP/US 분리가 무의미해져 있었다).
// 기기 언어로 국가를 정해 **명시적으로** 보낸다. 규칙은 services/shortsEntry.ts와 동일하게 스토어
// 지역이 아니라 **언어** 기준 — 한국어 사용자는 폰 지역이 US여도 한국 콘텐츠를 원한다.
// 백엔드 화이트리스트는 KR/JP/US이고 그 외는 서비스 계층이 US로 폴백한다.
const LANG_TO_COUNTRY: Record<string, string> = { ko: 'KR', ja: 'JP' };
export function deviceCountry(): string {
  try {
    const loc = Localization.getLocales()[0];
    const lang = (loc?.languageCode || '').toLowerCase();
    return LANG_TO_COUNTRY[lang] || (loc?.regionCode || '').toUpperCase();
  } catch {
    return '';
  }
}

export const shortsHotApi = {
  list: (category: string): Promise<ShortsHotVideo[]> => {
    const country = deviceCountry();
    const q = `category=${encodeURIComponent(category)}${country ? `&country=${encodeURIComponent(country)}` : ''}`;
    return request<ShortsHotVideo[]>(`/shorts-hot?${q}`);
  },
};

// 2026-08-01 — 홈 배너 인사이트 문구(힐링/명언/기능가이드/통계템플릿) 백엔드 이전. 문구 하나 고칠
// 때마다 앱스토어 재배포하던 걸 없애려는 목적(usageInsight.ts 참고) — DB insight_item 테이블,
// InsightController(/insights)가 카테고리별로 묶어서 반환.
export type InsightBundle = {
  healing: FlatContent[];
  quote: FlatContent[];
  tip: FlatContent[];
  statYesterdayLastWatched: FlatContent[];
  statTodayMoreThanAvg: FlatContent[];
  statTodayLessThanAvg: FlatContent[];
};
export const insightApi = {
  getBundle: (): Promise<InsightBundle> => request<InsightBundle>('/insights'),
};
