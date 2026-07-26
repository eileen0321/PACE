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
    const deviceId = await getOrCreateDeviceId();
    // 2026-07-27 사용자 지적("로그아웃하면 Guest 뜨기 전에 '-'가 잠깐 보였다 시간차 두고 바뀜") —
    // 서버 loginAsGuest 호출(네트워크 왕복)이 끝나야 user가 채워져서, 그동안 settings.tsx의
    // `user?.email ?? '-'` 폴백이 그대로 노출됐다. 게스트 신원 자체는 deviceId만 있으면 로컬에서
    // 즉시 만들 수 있으므로, 먼저 이 로컬 유저로 낙관적 반영(화면에 바로 "Guest") 하고, 서버 호출은
    // 백그라운드에서 계속해 성공하면 서버 발급 값으로 조용히 교체한다 — 실패해도 이미 로컬 유저가
    // set돼 있으니 추가로 할 일이 없다(기존 catch 폴백과 최종 상태 동일).
    const localUser: User = {
      id: `local-${deviceId}`,
      email: null,
      name: null,
      avatarUrl: null,
      provider: 'guest',
      isGuest: true,
      createdAt: new Date().toISOString(),
    };
    set({ user: localUser, isLoggedIn: true, isGuest: true });
    try {
      const result = await authApi.loginAsGuest(deviceId);
      await setToken(result.token);
      const user = toUser(result, true);
      await AsyncStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(user));
      set({ user, isLoggedIn: true, isGuest: true });
    } catch {
      // ⚠️ 실기기 테스트로 발견한 버그: 백엔드가 아직 없어서(API_BASE_URL 자리표시자) 이 catch가
      // 항상 실행되는데, 예전엔 여기서 그냥 포기해 user가 영원히 null로 남았다 — 그 결과 SQLite
      // 세션 기록(startSession)이 user.id를 요구하는 모든 화면(app/overlay 등)이 조용히 broken 상태였음.
      // deviceId 기반 로컬 전용 유저로 폴백해 오프라인에서도 SQLite/설정 등 나머지 기능이 정상 동작하게 한다.
      // 실 백엔드가 붙으면 이 id로 만든 로컬 데이터를 서버 발급 id로 마이그레이션하는 로직이 필요하다.
      await AsyncStorage.setItem(STORAGE_KEYS.authUser, JSON.stringify(localUser));
    }
  },

  logout: async () => {
    await googleAuth.signOut();
    await clearToken();
    await AsyncStorage.multiRemove(USER_SCOPED_KEYS);
    useSubscriptionStore.getState().reset().catch(() => {}); // RC 익명 ID로 리셋
    await get().loginAsGuest(); // 아래 loginAsGuest가 즉시 로컬 게스트를 set하므로 user:null 노출 구간 없음
  },
}));
