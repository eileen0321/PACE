import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../storage/keys';

// 커스텀 백엔드 REST 클라이언트 (zen-master src/common/services/api.ts 패턴 이식).
// Supabase 대신 자체 API 서버 + JWT를 쓰기로 결정 — PACE_ARCHITECTURE.md "확정 결정" 참고.
export const API_BASE_URL = __DEV__
  ? process.env.EXPO_PUBLIC_API_BASE_URL_DEV || 'http://localhost:8080'
  : process.env.EXPO_PUBLIC_API_BASE_URL || '';

let cachedToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  cachedToken = await AsyncStorage.getItem(STORAGE_KEYS.authToken);
  return cachedToken;
}

export async function setToken(token: string): Promise<void> {
  cachedToken = token;
  await AsyncStorage.setItem(STORAGE_KEYS.authToken, token);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  await AsyncStorage.removeItem(STORAGE_KEYS.authToken);
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean; // true면 Authorization 헤더 부착 (기본 true)
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
