import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutLeft } from 'react-native-reanimated';
import { STORAGE_KEYS } from '../../services/storage/keys';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';
import type { TranslationKey } from '../../services/i18n';

// healthy-shorts-assistant(4) Onboarding.tsx 이식(사용자 명시적 지시, 2026-07-21) — Framer
// Motion 기반 웹 애니메이션을 react-native-reanimated의 entering/exiting 레이아웃 애니메이션으로
// 대체. 원본 3슬라이드(도파민 차단막/Auto Next/블루투스) 내용은 그대로 가져오되, "Hands-Free"라는
// 이름을 Auto Next와 블루투스 둘 다에 재사용하면 Settings의 실제 "Hands-Free Control"(블루투스
// 리모컨) 기능과 헷갈린다는 이전 세션 결정에 따라 2번 슬라이드는 "Continuous Playback"으로 이름을
// 분리했다.
const SLIDE_THEME = {
  shield: { accent: '#818CF8', icon: 'shield' as const },
  autopilot: { accent: '#34D399', icon: 'repeat' as const },
  bluetooth: { accent: '#F59E0B', icon: 'headphones' as const },
};

type SlideKey = keyof typeof SLIDE_THEME;
const SLIDE_KEYS: SlideKey[] = ['shield', 'autopilot', 'bluetooth'];

function SlideVisual({ slideKey }: { slideKey: SlideKey }) {
  const theme = SLIDE_THEME[slideKey];
  return (
    <View style={styles.visualWrap}>
      <View style={[styles.visualRing, { borderColor: `${theme.accent}66` }]} />
      <View style={[styles.visualCore, { backgroundColor: `${theme.accent}1A`, borderColor: `${theme.accent}33` }]}>
        <Feather name={theme.icon} size={32} color={theme.accent} />
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [index, setIndex] = useState(0);

  const slideKey = SLIDE_KEYS[index];
  const theme = SLIDE_THEME[slideKey];
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
      <View style={[styles.glow, { backgroundColor: `${theme.accent}26` }]} />

      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>P</Text>
          </View>
          <Text style={styles.brandLabel}>{t('onboarding.protocol')}</Text>
        </View>
        {!isLast && (
          <Pressable onPress={finish} style={styles.skipButton}>
            <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
          </Pressable>
        )}
      </View>

      <Animated.View key={slideKey} entering={SlideInRight.duration(280)} exiting={SlideOutLeft.duration(200)} style={styles.slideBody}>
        <View style={styles.visualCard}>
          <SlideVisual slideKey={slideKey} />
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <Text style={styles.badgeText}>{t(`onboarding.slide${n}Badge` as TranslationKey)}</Text>
          </View>
        </View>

        <View style={styles.textBlock}>
          <Text style={styles.featureLabel}>{t('onboarding.featureLabel', { n })}</Text>
          <Text style={styles.title}>{t(`onboarding.slide${n}Title` as TranslationKey)}</Text>
          <Text style={styles.subtitle}>{t(`onboarding.slide${n}Subtitle` as TranslationKey)}</Text>
        </View>

        <Text style={styles.description}>{t(`onboarding.slide${n}Description` as TranslationKey)}</Text>

        <View style={styles.bulletList}>
          {[1, 2, 3].map((b) => (
            <View key={b} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: theme.accent }]}>
                <Feather name="check" size={10} color="#FFFFFF" />
              </View>
              <Text style={styles.bulletText}>{t(`onboarding.slide${n}Bullet${b}` as TranslationKey)}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDE_KEYS.map((key, i) => (
            <Pressable key={key} onPress={() => setIndex(i)} hitSlop={8}>
              <View style={[styles.dot, i === index && [styles.dotActive, { backgroundColor: theme.accent }]]} />
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
  glow: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.6,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  brandBadge: { width: 20, height: 20, borderRadius: 6, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold },
  brandLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 2, color: colors.textTertiary, textTransform: 'uppercase' },
  skipButton: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle },
  skipText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1, color: colors.textTertiary, textTransform: 'uppercase' },
  slideBody: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  visualCard: {
    backgroundColor: colors.card,
    borderRadius: radius.cardLarge,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  visualWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  visualRing: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 1 },
  visualCore: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1.5, color: '#FFFFFF', textTransform: 'uppercase' },
  textBlock: { gap: 4 },
  featureLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 2, color: colors.primary, textTransform: 'uppercase' },
  title: { fontSize: 24, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  description: { fontSize: 12, color: colors.textSecondary, lineHeight: 19 },
  bulletList: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletDot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  bulletText: { flex: 1, fontSize: 12, fontFamily: typography.bodyFontFamilySemibold, color: colors.textSecondary, lineHeight: 18 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 24 },
  nextButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  nextButtonText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1.5, color: '#FFFFFF', textTransform: 'uppercase' },
});
