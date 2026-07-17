import { useState } from 'react';
import { Alert, StyleSheet, Text, View, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../../store/useUserStore';
import { googleAuth } from '../../services/auth/google';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';

// Google/Apple 실제 SDK 연동 완료(services/auth/google.ts, apple.ts) — 다만 실기기 검증은
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID 등 실제 키 + EAS Dev Client 빌드가 있어야 가능(Expo Go 불가).
// 키가 없으면 googleAuth.isAvailable()이 false라 버튼이 자동으로 숨는다.
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
        <Text style={styles.title}>{t('auth.title')}</Text>
        {Platform.OS === 'ios' && (
          <Pressable style={styles.button} onPress={onApple} disabled={busy}>
            <Text style={styles.buttonText}>{t('auth.continueWithApple')}</Text>
          </Pressable>
        )}
        {googleAuth.isAvailable() && (
          <Pressable style={styles.button} onPress={onGoogle} disabled={busy}>
            <Text style={styles.buttonText}>{t('auth.continueWithGoogle')}</Text>
          </Pressable>
        )}
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
  content: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { fontSize: 28, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary, marginBottom: spacing.md },
  button: { backgroundColor: colors.card, borderRadius: radius.button, paddingVertical: spacing.md, alignItems: 'center' },
  buttonText: { fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  guestButton: { paddingVertical: spacing.md, alignItems: 'center' },
  guestText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold },
});
