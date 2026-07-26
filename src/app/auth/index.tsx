import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useUserStore } from '../../store/useUserStore';
import { googleAuth } from '../../services/auth/google';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';

// Google/Apple 실제 SDK 연동 완료(services/auth/google.ts, apple.ts) — 다만 실기기 검증은
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID 등 실제 키 + EAS Dev Client 빌드가 있어야 가능(Expo Go 불가).
// 키가 없으면 googleAuth.isAvailable()이 false라 버튼이 자동으로 숨는다.
//
// 2026-07-26 사용자 지적("UI 저딴식으로 만들거야?") — 기존엔 아이콘 하나 없이 카드색 배경 위에
// 텍스트만 있는 버튼이라 앱의 다른 화면들과 톤이 안 맞았다. 로고 아이콘(Ionicons logo-google/
// logo-apple, 이미 다른 화면에서 쓰는 아이콘 세트라 새 의존성 없음) + 상단 브랜드 헤더 추가.
// Apple 버튼은 커스텀 텍스트 버튼 대신 expo-apple-authentication의 공식
// AppleAuthenticationButton으로 교체(§2-C C2, HIG 4.8 리뷰 리스크 해결 겸사겸사).
export default function AuthScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const loginAsGuest = useUserStore((s) => s.loginAsGuest);
  const signInWithGoogle = useUserStore((s) => s.signInWithGoogle);
  const signInWithApple = useUserStore((s) => s.signInWithApple);
  const [busy, setBusy] = useState(false);

  const goHome = () => router.replace('/(tabs)/home');

  const onGoogle = async () => {
    setBusy(true);
    try {
      const result = await signInWithGoogle();
      if (!result.cancelled) goHome();
    } catch (e: any) {
      Alert.alert(t('auth.loginFailedTitle'), e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onApple = async () => {
    setBusy(true);
    try {
      const result = await signInWithApple();
      if (!result.cancelled) goHome();
    } catch (e: any) {
      Alert.alert(t('auth.loginFailedTitle'), e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.headerBlock}>
          <View style={styles.iconWrap}>
            <Ionicons name="log-in-outline" size={26} color={colors.primary} />
          </View>
          <Text style={styles.title}>{t('auth.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
        </View>

        <View style={styles.buttonGroup}>
          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={radius.button}
              style={styles.appleButton}
              onPress={onApple}
            />
          )}
          {googleAuth.isAvailable() && (
            <Pressable style={styles.button} onPress={onGoogle} disabled={busy}>
              <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
              <Text style={styles.buttonText}>{t('auth.continueWithGoogle')}</Text>
            </Pressable>
          )}
          {busy && <ActivityIndicator color={colors.primary} style={styles.spinner} />}
        </View>

        <Pressable
          style={styles.guestButton}
          onPress={async () => {
            await loginAsGuest();
            goHome();
          }}
        >
          <Text style={styles.guestText}>{t('auth.continueAsGuest')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  content: { flex: 1, justifyContent: 'center' },
  headerBlock: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl },
  iconWrap: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: `${colors.primary}1A`, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { fontSize: 24, fontFamily: typography.displayFontFamily, color: colors.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 13.5, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, textAlign: 'center', maxWidth: '85%', lineHeight: 19, marginTop: 4 },
  buttonGroup: { gap: spacing.sm },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
  },
  buttonText: { fontSize: 14, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  appleButton: { height: 50 },
  spinner: { marginTop: spacing.xs },
  guestButton: { paddingVertical: spacing.lg, alignItems: 'center' },
  guestText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
});
