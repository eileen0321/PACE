import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, clearToken, setToken, setUnauthorizedHandler } from '../services/api/client';
import { getOrCreateDeviceId } from '../services/auth/deviceId';
import { googleAuth } from '../services/auth/google';
import { appleAuth } from '../services/auth/apple';
import { STORAGE_KEYS, USER_SCOPED_KEYS } from '../services/storage/keys';
import { useSubscriptionStore } from './useSubscriptionStore';
import type { User } from '../types/models';

// zen-master AuthContext.tsx의 세션 복원/게스트 부트스트랩/401 자동로그아웃 로직을
// Zustand 액션으로 이식 (Context Provider 대신 store + init() 1회 호출 패턴).
type UserState = {
  user: User | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  isGuest: boolean;
  init: () => Promise<void>;
  /** idToken을 이미 들고 있을 때(예: 테스트) 직접 로그인 */
  loginWithGoogle: (idToken: string) => Promise<void>;
  loginWithApple: (identityToken: string, name?: string, authorizationCode?: string) => Promise<void>;
  /** 실제 화면에서 쓰는 진입점 — SDK 호출부터 백엔드 로그인까지 한 번에 처리 */
  signInWithGoogle: () => Promise<{ cancelled?: true }>;
  signInWithApple: () => Promise<{ cancelled?: true }>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

function toUser(result: { userId: string; email: string | null; name: string | null }, isGuest: boolean, provider: User['provider'] = 'google'): User {
  return {
    id: result.userId,
    email: result.email,
    name: result.name,
    avatarUrl: null,
    provider: isGuest ? 'guest' : provider,
    isGuest,
    createdAt: new Date().toISOString(),
  };
}

// jlpt-master RevenueCat 계약(PACE_ARCHITECTURE.md "외부 리뷰 반영 3차" 참고): 로그인 시
// Purchases.logIn(email)로 RC app_user_id를 이메일로 승격해야 기기 변경 후에도 구독이 이어진다.
// 게스트는 이메일이 없으므로 식별하지 않고(RC 익명 ID 유지), 실패해도 로그인 자체는 막지 않는다.
function identifyRcUser(email: string | null) {
  if (!email) return;
  useSubscriptionStore.getState().identify(email).catch(() => {});
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  isLoading: true,
  isLoggedIn: false,
  isGuest: false,

  init: async () => {
    setUnauthorizedHandler(() => {
      // 401 시 자동 로그아웃 — 진행도(SQLite)는 보존, 인증 상태만 회수(zen-master 전략 A와 동일)
      get().logout().catch(() => {});
    });
    googleAuth.configure();
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.authUser);
      if (raw) {
        const restoredUser: User = JSON.parse(raw);
        set({ user: restoredUser, isLoggedIn: true, isGuest: restoredUser.isGuest });
        identifyRcUser(restoredUser.email);
      } else {
        await get().loginAsGuest();
      }
    } finally {
      set({ isLoading: false });
    }
  },

  loginWithGoogle: async (idToken) => {
    const result = await authApi.loginWithGoogleIdToken(idToken);
    await setToken(result.token);
    const user = toUser(result, false, 'google');
    await AsyncStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(user));
    set({ user, isLoggedIn: true, isGuest: false });
    identifyRcUser(user.email);
  },

  loginWithApple: async (identityToken, name, authorizationCode) => {
    const result = await authApi.loginWithAppleIdToken(identityToken, name, authorizationCode);
    await setToken(result.token);
    const user = toUser(result, false, 'apple');
    await AsyncStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(user));
    set({ user, isLoggedIn: true, isGuest: false });
    identifyRcUser(user.email);
  },

  signInWithGoogle: async () => {
    const result = await googleAuth.signIn();
    if ('cancelled' in result) return { cancelled: true as const };
    await get().loginWithGoogle(result.idToken);
    return {};
  },

  signInWithApple: async () => {
    const result = await appleAuth.signIn();
    if ('cancelled' in result) return { cancelled: true as const };
    await get().loginWithApple(result.identityToken, result.name ?? undefined, result.authorizationCode ?? undefined);
    return {};
  },

  loginAsGuest: async () => {
    try {
      const deviceId = await getOrCreateDeviceId();
      const result = await authApi.loginAsGuest(deviceId);
      await setToken(result.token);
      const user = toUser(result, true);
      await AsyncStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(user));
      set({ user, isLoggedIn: true, isGuest: true });
    } catch {
      // 오프라인이면 게스트 세션 없이도 로컬 SQLite만으로 앱은 동작 가능
    }
  },

  logout: async () => {
    await googleAuth.signOut();
    await clearToken();
    await AsyncStorage.multiRemove(USER_SCOPED_KEYS);
    set({ user: null, isLoggedIn: false, isGuest: false });
    useSubscriptionStore.getState().reset().catch(() => {}); // RC 익명 ID로 리셋
    await get().loginAsGuest();
  },

  deleteAccount: async () => {
    await authApi.deleteAccount();
    await clearToken();
    await AsyncStorage.multiRemove(USER_SCOPED_KEYS);
    set({ user: null, isLoggedIn: false, isGuest: false });
    useSubscriptionStore.getState().reset().catch(() => {});
    await get().loginAsGuest();
  },
}));
