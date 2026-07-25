import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import Animated, { SlideInRight, SlideOutLeft } from 'react-native-reanimated';
import { STORAGE_KEYS } from '../../services/storage/keys';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';
import type { TranslationKey } from '../../services/i18n';

// healthy-shorts-assistant(4) Onboarding.tsx 이식(2026-07-21) 이후 사용자 지적(2026-07-25,
// "부팅 타임 가이드 페이지 너무 촌스러운거 아냐?") — 원형 아이콘 링 + 컬러 배지 필 + 체크마크
// 불릿리스트 + 그라데이션 글로우 조합이 전형적인 "기능 소개 랜딩페이지" 템플릿처럼 읽힌다는 지적에
// 따라 미니멀 텍스트 중심으로 재설계(사용자 선택). 그래픽 요소를 걷어내고 큰 타이포 타이틀 +
// 짧은 한 줄 설명 + 얇은 색상 액센트 바만 남긴다.
const SLIDE_ACCENTS = ['#818CF8', '#34D399', '#F59E0B'] as const;
type SlideKey = 0 | 1 | 2;
const SLIDE_KEYS: SlideKey[] = [0, 1, 2];

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [index, setIndex] = useState(0);

  const slideKey = SLIDE_KEYS[index];
  const accent = SLIDE_ACCENTS[slideKey];
  const isLast = index === SLIDE_KEYS.length - 1;
  const n = index + 1;

  const finish = () => {
    AsyncStorage.setItem(STORAGE_KEYS.onboardingCompleted, 'true').catch(() => {});
    // 2026-07-21 밤 사용자 지시(PACE_ARCHITECTURE.md "런치 플로우 단순화") — 맨 처음 온보딩을 마친
    // 직후엔 앱(Home 탭)으로 들어간다. 곧바로 Overlay/YouTube로 가는 건 "그 다음 실행부터"만
    // 해당(index.tsx의 콜드스타트 분기 참고) — 온보딩 자체를 처음 겪는 순간까지 세션으로 밀어넣지
    // 않는다.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  const handleNext = () => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brandLabel}>{t('onboarding.protocol')}</Text>
        {!isLast && (
          <Pressable onPress={finish} hitSlop={8}>
            <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
          </Pressable>
        )}
      </View>

      <Animated.View key={slideKey} entering={SlideInRight.duration(220)} exiting={SlideOutLeft.duration(160)} style={styles.slideBody}>
        <View style={[styles.accentBar, { backgroundColor: accent }]} />
        <Text style={styles.featureLabel}>{t('onboarding.featureLabel', { n })}</Text>
        <Text style={styles.title}>{t(`onboarding.slide${n}Title` as TranslationKey)}</Text>
        <Text style={styles.description}>{t(`onboarding.slide${n}Description` as TranslationKey)}</Text>
      </Animated.View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDE_KEYS.map((key, i) => (
            <Pressable key={key} onPress={() => setIndex(i)} hitSlop={8}>
              <View style={[styles.dot, i === index && [styles.dotActive, { backgroundColor: accent }]]} />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={handleNext} style={[styles.nextButton, { backgroundColor: colors.primary }]}>
          <Text style={styles.nextButtonText}>{isLast ? t('onboarding.begin') : t('onboarding.next')}</Text>
          <Feather name="chevron-right" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1, color: colors.textPrimary },
  skipText: { fontSize: 12, fontFamily: typography.bodyFontFamilySemibold, color: colors.textTertiary },
  slideBody: { flex: 1, justifyContent: 'center', gap: spacing.md, paddingBottom: spacing.xl },
  accentBar: { width: 28, height: 4, borderRadius: 2 },
  featureLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilySemibold, letterSpacing: 1, color: colors.textTertiary },
  title: { fontSize: 34, lineHeight: 40, fontFamily: typography.displayFontFamily, color: colors.textPrimary, letterSpacing: -0.5 },
  description: { fontSize: 16, lineHeight: 24, fontFamily: typography.bodyFontFamily, color: colors.textSecondary, maxWidth: '90%' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 24 },
  nextButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  nextButtonText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1.5, color: '#FFFFFF', textTransform: 'uppercase' },
});
