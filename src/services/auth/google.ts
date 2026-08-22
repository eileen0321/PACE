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

// 2026-08-22 — Credential Manager(바텀시트) 경로. pace-overlay 네이티브 모듈이 제공한다.
// ⚠️ 이 파일의 기존 동작에 **아무 영향도 주지 않는 것**이 설계 조건이다:
//   · Android가 아니거나 모듈이 없으면 아예 시도하지 않는다(위 방어적 require와 같은 이유 —
//     Expo Go/미링크 빌드에서 require가 throw하면 앱이 안 뜬다).
//   · 어떤 실패든 null을 돌려주고, 호출부는 그대로 기존 레거시 경로로 내려간다.
//   · 단 하나의 예외가 사용자 취소다 — 취소했는데 레거시 팝업을 또 띄우면 더 나쁘므로
//     그때는 cancelled로 끝낸다.
let paceOverlayNative: any = null;
if (Platform.OS === 'android') {
  try {
    paceOverlayNative = require('../../../modules/pace-overlay').PaceOverlay ?? null;
  } catch {
    paceOverlayNative = null; // 미링크 빌드 — 조용히 비활성화하고 레거시 경로만 쓴다.
  }
}

type SignInOk = { idToken: string };
type SignInCancelled = { cancelled: true };

async function signInWithCredentialManager(): Promise<SignInOk | SignInCancelled | null> {
  const fn = paceOverlayNative?.googleSignInWithCredentialManager;
  if (typeof fn !== 'function') return null; // 이 빌드엔 아직 없는 함수 — 폴백.

  // 1단계 'authorized': 이 앱에 로그인한 적 있는 계정만 — 틱톡식 "다시 로그인" 시트로, 탭 한 번에 끝난다.
  // 2단계 'button'    : 그런 계정이 없으면(첫 로그인) 계정 선택 바텀시트를 항상 띄우는 옵션으로 넘어간다.
  //   ⚠️ 2단계를 GetGoogleIdOption(filter=false)로 하면 안 된다 — 계정이 3개 있는 실기기에서도
  //     NoCredentialException이 났다(자세한 근거는 PaceGoogleSignIn.kt 주석).
  for (const mode of ['authorized', 'button'] as const) {
    try {
      const idToken = await fn(WEB_CLIENT_ID, mode);
      if (typeof idToken === 'string' && idToken.length > 0) return { idToken };
      return null; // 토큰이 비어 오면 레거시로.
    } catch (e: any) {
      const code = e?.code ?? '';
      if (code === 'CANCELLED') return { cancelled: true };
      if (code === 'NO_CREDENTIAL' && mode === 'authorized') continue; // 2단계로.
      // 2단계까지 실패 = 기기에 구글 계정 자체가 없거나 Play 서비스 문제 → 계정 추가를 안내할 수
      // 있는 레거시 경로가 낫다. 그 외 모든 실패도 동일하게 폴백.
      console.warn('[auth/google] Credential Manager 실패 — 레거시 경로로 폴백:', code || e?.message);
      return null;
    }
  }
  return null;
}

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
    // 🔴 2026-08-22 사장님 지적("틱톡처럼 바텀시트로 띄우던가") — Android는 Credential Manager
    //   경로를 먼저 시도한다. 레거시 GoogleSignin.signIn()은 play-services-auth의 전체화면
    //   다이얼로그(AccountPickerActivity)를 띄우는데, 라이트 모드 기기에서 흰 카드 + 회색 하단
    //   띠로 나와 다크 고정인 우리 앱에서 유독 깨져 보였다(같은 폰에서 틱톡과 비교 측정함 —
    //   자세한 근거는 modules/.../PaceGoogleSignIn.kt 상단 주석).
    //   실패하면 아래 레거시 경로로 그대로 폴백하므로, 이 시도가 로그인을 막는 일은 없다.
    if (Platform.OS === 'android' && WEB_CLIENT_ID) {
      const viaSheet = await signInWithCredentialManager();
      if (viaSheet) return viaSheet;
    }
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
