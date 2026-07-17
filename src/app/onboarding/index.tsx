import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Pace</Text>
        <Text style={styles.subtitle}>{t('onboarding.subtitle')}</Text>
      </View>
      <Pressable style={styles.cta} onPress={() => router.replace('/(tabs)/home')}>
        <Text style={styles.ctaText}>{t('onboarding.getStarted')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'space-between' },
  content: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { fontSize: 40, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  subtitle: { fontSize: 16, color: colors.textSecondary, lineHeight: 24 },
  cta: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.md, alignItems: 'center' },
  ctaText: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 16 },
});
