import { Platform } from 'react-native';

// zen-master AuthContext.tsx의 방어적 require 패턴 이식: google-signin 네이티브 모듈은
// TurboModuleRegistry.getEnforcing()을 require 시점에 무조건 호출해, 링크 안 된 빌드(Expo Go 등)에서
// 즉시 throw한다. 이 서비스는 App 최상단 store init에서 불려서 죽으면 앱이 아예 안 뜨므로 방어 require.
// 2026-07-17 웹 조사: Expo 공식 가이드도 expo-auth-session(브라우저 OAuth) 대신 이 네이티브 모듈을
// 권장하며, Expo Go에서는 동작하지 않고 Dev Client 빌드가 필요하다고 명시한다.
let GoogleSignin: any = null;
let statusCodes: { SIGN_IN_CANCELLED?: string; [key: string]: any } = {};
let loadOk = false;

if (Platform.OS !== 'web') {
  try {
    const mod = require('@react-native-google-signin/google-signin');
    GoogleSignin = mod.GoogleSignin;
    statusCodes = mod.statusCodes;
    if (!GoogleSignin) throw new Error('GoogleSignin export missing');
    loadOk = true;
  } catch (e) {
    console.warn('[auth/google] 네이티브 모듈 로드 실패 — Dev Client 빌드가 아니면 정상(Google 로그인 비활성화):', e);
  }
}

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

export const googleAuth = {
  isAvailable: () => loadOk && !!WEB_CLIENT_ID,

  configure() {
    if (!loadOk || !WEB_CLIENT_ID) return;
    // iOS는 iosClientId 없이 configure()를 부르면 네이티브 예외로 앱이 크래시한다(JS try/catch로 못 잡음) — 가드.
    if (Platform.OS === 'ios' && !IOS_CLIENT_ID) {
      console.warn('[auth/google] EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID 미설정 — iOS Google 로그인 configure 스킵');
      return;
    }
    GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      ...(IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}),
      offlineAccess: false,
    });
  },

  async signIn(): Promise<{ idToken: string } | { cancelled: true }> {
    if (!loadOk) throw new Error('GOOGLE_SIGNIN_NOT_AVAILABLE');
    await GoogleSignin.hasPlayServices();
    // 로그아웃→재로그인 시 캐시된 만료 idToken을 그대로 돌려주는 것을 방지 — 매번 새 토큰 강제.
    try { await GoogleSignin.signOut(); } catch { /* ignore */ }
    const response = await GoogleSignin.signIn();
    if ((response as any)?.type === 'cancelled' || !response?.data) return { cancelled: true };
    const idToken = response.data?.idToken;
    if (!idToken) throw new Error('NO_ID_TOKEN');
    return { idToken };
  },

  async signOut(): Promise<void> {
    if (!loadOk) return;
    await GoogleSignin.signOut().catch(() => {});
  },

  isCancelledError(error: any): boolean {
    return error?.code === statusCodes.SIGN_IN_CANCELLED;
  },
};
