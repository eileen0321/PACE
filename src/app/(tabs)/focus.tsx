import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useUserStore } from '../../store/useUserStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useTranslation } from '../../services/i18n';
import { capabilities } from '../../services/platform';
import { AppHeader } from '../../components/ui/AppHeader';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) SettingsSection.tsx(Focus 탭)를 토씨 하나 안 틀리고 그대로 이식
// (사용자 명시적 지시)으로 시작했으나, 2026-07-22 사용자 지시로 여러 차례 단순화됨 — Session
// Status/Android Guard Services 카드는 Settings 화면으로 이전(settings.tsx 참고), Session Stats
// 3그리드는 분석(Stats) 탭과 중복이라 삭제, Hands-Free Control(Previous/Next/Auto Mode 버튼)과
// Session Controls(Auto Next 토글 + End Session 버튼, 딸린 Finish Session 확인 모달 포함)도 삭제
// — Focus 탭을 Session Control Hero → Extend Time → Interventions → (iOS)Pace Feed 진입만 남겨
// 단순화. 원본은 minutesWatched를 로컬 데모 state로 관리했는데, Pace는 실제 useStatsStore
// (todayUsageMinutes) 데이터로 대체했다 — "죽은 코드/가짜 데이터로 남기지 말라"는 별도 지시에 따름.
// Break Reminder/Healthy Pause 토글도 실제 useSettingsStore에 연결.
export default function FocusScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const adBannerHeight = useAdBannerStore((s) => s.height);
  const tabBarHeight = useAdBannerStore((s) => s.tabBarHeight);
  const { settings, update } = useSettingsStore();
  const { todayUsageMinutes, refresh } = useStatsStore();
  const { extraMinutes: bonusMinutes } = useDailyBonusStore();
  const [showPromptDemo, setShowPromptDemo] = useState(false);

  useEffect(() => {
    if (user?.id) refresh(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refresh]);

  // 2026-07-18 버그 수정: Extend Time(+10/20/30m)이 예전엔 settings.dailyLimitMinutes를 직접 올려버려서
  // "오늘만" 늘려주려던 의도와 달리 다음날 이후에도 영구히 늘어난 한도가 유지됐다. 이제 오늘 하루치
  // 보너스(useDailyBonusStore, 날짜 바뀌면 자동 리셋)를 더해서만 계산 — 영속 설정 자체는 안 건드린다.
  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;
  const remainingMinutes = Math.max(0, effectiveDailyLimitMinutes - todayUsageMinutes);
  const progressPct = Math.min(100, (todayUsageMinutes / Math.max(1, effectiveDailyLimitMinutes)) * 100);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + adBannerHeight }]} showsVerticalScrollIndicator={false}>
        {/* 1. Session Control Hero */}
        <LinearGradient colors={['#1A1D26', colors.cardDeep]} style={styles.heroCard}>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveTagText}>{t('focus.liveEngine')}</Text>
          </View>
          <Text style={styles.heroLabel}>{t('focus.focusSession')}</Text>
          <Text style={styles.heroTitle}>YouTube</Text>

          <View style={styles.splitRow}>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>{t('focus.watched')}</Text>
              <Text style={styles.splitValue}>{todayUsageMinutes}m</Text>
            </View>
            <View style={[styles.splitCol, styles.splitColRight]}>
              <Text style={styles.splitLabel}>{t('focus.remaining')}</Text>
              <Text style={[styles.splitValue, styles.splitValuePrimary]}>{remainingMinutes}m</Text>
            </View>
          </View>

          <View style={styles.heroTrack}>
            <View style={[styles.heroFill, { width: `${progressPct}%` }]} />
          </View>
        </LinearGradient>

        {/* 2026-07-27 사용자 지시 — "Extend Time"(+10/20/30m) 섹션 삭제. 코드 확인 결과 광고/프리미엄
            게이팅이 전혀 없는 useDailyBonusStore.addMinutes를 무제한으로 호출해, Daily Limit 자체를
            완전히 무력화하는 구멍이었다(LimitReachedOverlay의 광고 기반 +5분과 같은 저장소를 공짜로
            무한히 채울 수 있었음). Daily Limit을 늘리고 싶으면 Settings/Home에서 그 설정 자체를
            의식적으로 바꾸는 게 맞다는 판단 — bonusMinutes(광고로 받은 보너스)는 계산에 여전히
            반영되지만, 이 화면에서 직접 더하는 경로는 제거. */}

        {/* 3. Interventions & Shields */}
        {/* 2026-07-20 실기기 감사 중 발견(맥 세션 QA_ISSUES_2026-07-18.md #13) — "15분마다 작동"이
            하드코딩 라벨이라 실제 breakIntervalMinutes(기본 20분, Settings에서 10/20/30분 등으로
            변경 가능)와 어긋나 있었다. 게다가 여기서 토글을 켜면 실제 설정값과 무관하게 항상 15로
            덮어써서 값이 흐트러졌다 — 라벨을 실제값으로 표시하고, 토글 ON 시에도 기본값(20)으로
            통일해 최소한 다른 화면과 어긋나지 않게 정정. */}
        <GlassSurface style={styles.card}>
          <View style={styles.interventionRow}>
            <View>
              <Text style={styles.interventionTitle}>{t('focus.breakReminder')}</Text>
              <Text style={styles.interventionSub}>{t('focus.everyNMinutes', { n: settings.breakIntervalMinutes || DEFAULT_SETTINGS.breakIntervalMinutes })}</Text>
            </View>
            <Switch
              value={settings.breakIntervalMinutes > 0}
              onValueChange={(v) => update({ breakIntervalMinutes: v ? DEFAULT_SETTINGS.breakIntervalMinutes : 0 })}
              trackColor={{ true: colors.primary, false: '#262626' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#262626"
            />
          </View>
          <View style={[styles.interventionRow, styles.interventionRowBordered]}>
            <View>
              <Text style={styles.interventionTitle}>{t('focus.healthyPause')}</Text>
              <Text style={styles.interventionSub}>{t('focus.after18Videos')}</Text>
            </View>
            <View style={styles.interventionRight}>
              <Pressable onPress={() => setShowPromptDemo(true)}>
                <Text style={styles.demoLink}>{t('focus.demo')}</Text>
              </Pressable>
              <Switch
                value={settings.preSessionBreathing}
                onValueChange={(v) => update({ preSessionBreathing: v })}
                trackColor={{ true: colors.primary, false: '#262626' }}
              />
            </View>
          </View>
        </GlassSurface>

        {/* 4. iOS Pace Feed / dev POC 진입 (2026-07-18 iOS 전략 확정 — PACE_ARCHITECTURE.md 참고).
            Pace Feed = iOS에서 YouTube Shorts를 순차 재생하는 자체 화면(iOS 전용).
            QA #19 수정(2026-07-19): capabilities.supportsPaceFeed(iOS 전용)로 섹션 전체를 게이팅 —
            이전엔 라벨 접미사만 iOS 조건이고 버튼은 무조건 렌더돼 Android에도 노출됐음.
            NOTE(i18n): 스캐폴드 단계라 리터럴 문자열 — feed.* 키 배선은 후속 작업. */}
        {capabilities.supportsPaceFeed && (
        <View>
          <Text style={styles.sectionLabel}>Pace Feed</Text>
          <Pressable onPress={() => router.push('/feed')} style={styles.feedEntryBtn}>
            <View style={styles.feedEntryLeft}>
              <View style={styles.feedEntryIcon}><Feather name="play-circle" size={18} color={colors.successLight} /></View>
              <View style={styles.feedEntryTextWrap}>
                <Text style={styles.feedEntryTitle}>Open Pace Feed</Text>
                <Text style={styles.feedEntrySub}>차단 대신 볼 차분한 대체 피드</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textSecondary} />
          </Pressable>
          {__DEV__ && (
            <Pressable onPress={() => router.push('/dev/shorts-poc')} style={[styles.feedEntryBtn, styles.devEntryBtn]}>
              <View style={styles.feedEntryLeft}>
                <View style={styles.feedEntryIcon}><Feather name="alert-triangle" size={16} color={colors.warning} /></View>
                <View style={styles.feedEntryTextWrap}>
                  <Text style={styles.feedEntryTitle}>Shorts WebView POC (dev)</Text>
                  <Text style={styles.feedEntrySub}>원안 ① 자동넘김 검증용 · 출시 금지</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
        )}
      </ScrollView>

      {/* Demo Mindful Break Prompt Modal */}
      <Modal visible={showPromptDemo} transparent animationType="fade" onRequestClose={() => setShowPromptDemo(false)} statusBarTranslucent navigationBarTranslucent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.modalCardIndigo]}>
            <View style={styles.modalIconIndigo}>
              <Feather name="alert-circle" size={24} color={colors.primary} />
            </View>
            <Text style={styles.modalTitle}>{t('focus.timeToPause')}</Text>
            <Text style={styles.modalBody}>{t('focus.timeToPauseBody', { n: 18 })}</Text>
            <Pressable onPress={() => setShowPromptDemo(false)} style={styles.modalPrimaryBtn}>
              <Text style={styles.modalPrimaryBtnText}>{t('focus.continueMindfulWatch')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg },

  heroCard: { borderRadius: 30, padding: 24, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  liveTag: { position: 'absolute', top: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: '#A5B4FC', letterSpacing: 0.5, textTransform: 'uppercase' },
  heroLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase' },
  heroTitle: { fontSize: 24, fontFamily: typography.displayFontFamily, color: colors.textPrimary, marginTop: 4 },
  splitRow: { flexDirection: 'row', gap: spacing.md, paddingTop: 6 },
  splitCol: { flex: 1, borderLeftWidth: 2, borderLeftColor: `${colors.primary}66`, paddingLeft: spacing.sm },
  splitColRight: { borderLeftColor: `${colors.primary}CC` },
  splitLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  splitValue: { fontSize: 20, fontFamily: typography.monoFontFamilyBold, color: colors.textPrimary, marginTop: 2 },
  splitValuePrimary: { color: colors.primary },
  heroTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.pill, overflow: 'hidden' },
  heroFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },

  sectionLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },

  extendCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  extendLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  extendLabel: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#D1D5DB', letterSpacing: 0.5, textTransform: 'uppercase' },
  extendChips: { flexDirection: 'row', gap: 6 },
  extendChip: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  extendChipText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: '#818CF8', letterSpacing: 0.5 },

  interventionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  interventionRowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: spacing.xs, paddingTop: spacing.md },
  interventionTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  interventionSub: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: '#818CF8', marginTop: 2 },
  interventionRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  demoLink: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, textDecorationLine: 'underline', letterSpacing: 0.5, textTransform: 'uppercase' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 320, borderRadius: 28, padding: 24, alignItems: 'center', gap: spacing.md, borderWidth: 1 },
  modalCardIndigo: { backgroundColor: colors.card, borderColor: `${colors.primary}66` },
  modalIconIndigo: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: `${colors.primary}33`, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, textAlign: 'center' },
  modalBody: { fontSize: 12, color: '#D1D5DB', textAlign: 'center', lineHeight: 18 },
  modalPrimaryBtn: { width: '100%', backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalPrimaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },

  feedEntryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.sm },
  devEntryBtn: { borderColor: 'rgba(245,158,11,0.25)', borderStyle: 'dashed' },
  feedEntryLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  feedEntryTextWrap: { flex: 1 },
  feedEntryIcon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  feedEntryTitle: { fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  feedEntrySub: { fontSize: 11, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, marginTop: 2 },
});
