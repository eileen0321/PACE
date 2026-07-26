import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { STORAGE_KEYS } from '../../services/storage/keys';
import { useTranslation } from '../../services/i18n';
import { spacing, typography } from '../../constants/theme';

// 2026-07-26 사용자 지시 — Instagram Stories 제스처 가이드 참고 이미지 그대로: 스와이프로 넘기는
// 3~4장 캐러셀이 아니라, 4개 항목을 한 화면에 전부 나열하고 화면 아무 곳이나 탭하면 닫히는 단일
// 오버레이 카드. 배경도 불투명 단색이 아니라 남색→보라 그라데이션 반투명 오버레이(_layout.tsx에서
// presentation: 'transparentModal'로 등록 — 실제로 화면 위에 얹히는 오버레이). 아이콘은 이모지
// 대신 참고 이미지처럼 흰색 단색 라인 아이콘(Feather)으로 통일 — 사용자가 이모지 조합을 "촌스럽다"고
// 지적함.
const ROWS: { icon: keyof typeof Feather.glyphMap; titleKey: 'onboarding.row1Title' | 'onboarding.row2Title' | 'onboarding.row3Title' | 'onboarding.row4Title'; descKey: 'onboarding.row1Desc' | 'onboarding.row2Desc' | 'onboarding.row3Desc' | 'onboarding.row4Desc' }[] = [
  { icon: 'coffee', titleKey: 'onboarding.row1Title', descKey: 'onboarding.row1Desc' },
  { icon: 'star', titleKey: 'onboarding.row2Title', descKey: 'onboarding.row2Desc' },
  { icon: 'play', titleKey: 'onboarding.row3Title', descKey: 'onboarding.row3Desc' },
  { icon: 'moon', titleKey: 'onboarding.row4Title', descKey: 'onboarding.row4Desc' },
];

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const finish = () => {
    AsyncStorage.setItem(STORAGE_KEYS.onboardingCompleted, 'true').catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  return (
    <Pressable style={styles.flex} onPress={finish}>
      <LinearGradient colors={['rgba(30,41,80,0.97)', 'rgba(76,29,135,0.97)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.flex}>
        <SafeAreaView style={styles.container}>
          <View style={styles.headerBlock}>
            <Text style={styles.title}>{t('onboarding.overlayTitle')}</Text>
            <Text style={styles.subtitle}>{t('onboarding.overlaySubtitle')}</Text>
          </View>

          <View style={styles.rows}>
            {ROWS.map((row) => (
              <View key={row.icon} style={styles.row}>
                <View style={styles.iconWrap}>
                  <Feather name={row.icon} size={22} color="#FFFFFF" />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{t(row.titleKey)}</Text>
                  <Text style={styles.rowDesc}>{t(row.descKey)}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.dismissLabel}>{t('onboarding.tapToContinue')}</Text>
        </SafeAreaView>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center', gap: spacing.xl },
  headerBlock: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  title: { fontSize: 22, fontFamily: typography.displayFontFamily, color: '#FFFFFF', letterSpacing: -0.3, textAlign: 'center' },
  subtitle: { fontSize: 13.5, lineHeight: 19, fontFamily: typography.bodyFontFamily, color: 'rgba(255,255,255,0.65)', textAlign: 'center', maxWidth: '85%', alignSelf: 'center' },
  rows: { gap: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 40, alignItems: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyBold, color: '#FFFFFF' },
  rowDesc: { fontSize: 13, lineHeight: 18, fontFamily: typography.bodyFontFamily, color: 'rgba(255,255,255,0.6)' },
  dismissLabel: { textAlign: 'center', fontSize: 12.5, fontFamily: typography.bodyFontFamilySemibold, color: 'rgba(255,255,255,0.55)', marginTop: spacing.lg },
});
