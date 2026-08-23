import { useEffect, useState } from 'react';
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

  // 2026-08-23 — 이 화면이 뜨는 즉시 구글 자격증명 조회를 데워둔다. 사장님 지적("바텀시트 뜨기 전에
  // 흰색 하단키가 잠깐 보였음") 대응으로, 시트가 그려지기까지의 공백(실측 ~0.8초)을 줄인다.
  // 실패해도 아무 영향 없다(services/auth/google.ts warmUp 주석 참고). Android 전용, 내부에서 가드.
  useEffect(() => { googleAuth.warmUp(); }, []);

  // 2026-07-27 사용자 지적 — "/auth"는 콜드 스타트 경로가 아니라 항상 Settings(로그아웃 행) 또는
  // Paywall("로그인 필요" 안내)에서 push로 들어온다(src/app/index.tsx 콜드 스타트는 onboarding/home만
  // 감, 이 화면을 절대 안 거침). 그런데 로그인 성공 후 무조건 router.replace('/(tabs)/home')을 불러
  // 어디서 왔든 Home으로 강제 이동시켰다 — Settings에서 로그인했는데 Home으로 튕기고, 스택을
  // replace하는 전환이라 화면이 번쩍였다. 항상 오는 곳이 있으므로 그냥 뒤로 돌아가면 된다.
  // 2026-08-02 방어(딥링크 콜드진입 대비) — pace://auth로 히스토리 없이 직접 열리면 back()이 "GO_BACK
  // 처리 안 됨"으로 화면이 안 닫힌다. 정상 흐름(Settings/Paywall push)은 그대로 back, 그 외엔 Home으로.
  const goHome = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'));

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
