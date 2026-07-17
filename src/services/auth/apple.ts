import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

// iOS 전용. expo-apple-authentication은 SDK 내장 모듈이라 zen-master의 방어적 require가 필요 없다
// (Config plugin이 자동 링크). iOS가 아니면 isAvailable()이 false를 반환해 상위 UI가 버튼을 숨긴다.
export const appleAuth = {
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    return AppleAuthentication.isAvailableAsync();
  },

  async signIn(): Promise<{ identityToken: string; name: string | null; authorizationCode: string | null } | { cancelled: true }> {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('NO_IDENTITY_TOKEN');
      // 애플은 최초 로그인 1회만 fullName을 내려준다 — 이후 재로그인 시 null이므로 최초 값을 호출부가 백업 저장해야 함.
      const name = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(' ') || null
        : null;
      return { identityToken: credential.identityToken, name, authorizationCode: credential.authorizationCode };
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return { cancelled: true };
      throw e;
    }
  },
};
