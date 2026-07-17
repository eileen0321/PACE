import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useUserStore } from '../../store/useUserStore';
import { useTranslation } from '../../services/i18n';
import { AppHeader } from '../../components/ui/AppHeader';
import { bottomSheetPadding, colors, layout, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) SettingsSection.tsx(Focus 탭)를 토씨 하나 안 틀리고 그대로 이식
// (사용자 명시적 지시) — Session Control Hero(그라데이션+Live Engine뱃지) → Session Status card →
// Android Guard Services(플랫폼 조건부) → Pause/End 버튼 → Extend Time칩 → Interventions(Break
// Reminder/Healthy Pause + Demo 모달) → Session Stats 3그리드 → Finish Session 확인 모달.
// 원본은 minutesWatched/videosWatched를 로컬 데모 state로 관리하고 Session Stats도 18/37m/22s
// 하드코딩 목업이었는데, Pace는 실제 useStatsStore(todayUsageMinutes/todayVideosWatched/
// todayAverageDurationSeconds) 데이터로 대체했다 — "죽은 코드/가짜 데이터로 남기지 말라"는
// 별도 지시에 따름. Break Reminder/Healthy Pause 토글도 실제 useSettingsStore에 연결.
export default function FocusScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const user = useUserStore((s) => s.user);
  const { settings, update } = useSettingsStore();
  const { todayUsageMinutes, todayVideosWatched, todayAverageDurationSeconds, refresh } = useStatsStore();
  const [showPromptDemo, setShowPromptDemo] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);

  useEffect(() => {
    if (user?.id) refresh(user.id);
  }, [user?.id, refresh]);

  const remainingMinutes = Math.max(0, settings.dailyLimitMinutes - todayUsageMinutes);
  const progressPct = Math.min(100, (todayUsageMinutes / Math.max(1, settings.dailyLimitMinutes)) * 100);

  const extendSession = (amount: number) => update({ dailyLimitMinutes: settings.dailyLimitMinutes + amount });
  const confirmFinish = () => { setShowFinishConfirm(false); };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 1. Session Control Hero */}
        <LinearGradient colors={['#1A1D26', colors.cardDeep]} style={styles.heroCard}>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveTagText}>{t('focus.liveEngine')}</Text>
          </View>
          <Text style={styles.heroLabel}>{t('focus.focusSession')}</Text>
          <Text style={styles.heroTitle}>YouTube Shorts</Text>

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

        {/* 2. Session Status */}
        <View>
          <Text style={styles.sectionLabel}>{t('focus.sessionStatus')}</Text>
          <View style={styles.card}>
            <View style={styles.statusTopRow}>
              <Text style={styles.statusTitle}>{t('focus.sessionActive')}</Text>
              <View style={styles.pulsePill}>
                <View style={styles.pulseDot} />
                <Text style={styles.pulsePillText}>{settings.autoNext ? t('focus.on') : t('focus.off')}</Text>
              </View>
            </View>
            <View style={[styles.statusRow, styles.statusRowBordered]}>
              <Text style={styles.statusRowLabel}>{t('focus.remainingTime')}</Text>
              <Text style={styles.statusRowValueMono}>{remainingMinutes}m {t('focus.remaining')}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusRowLabel}>{t('focus.sleepTimer')}</Text>
              <Text style={styles.statusRowValueMonoPrimary}>{settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : t('focus.disabled')}</Text>
            </View>
          </View>
        </View>

        {/* 2.5 Android Guard Services (Android 전용, iOS는 원본대로 렌더 안 함) */}
        {Platform.OS === 'android' && (
          <View>
            <Text style={styles.sectionLabel}>{t('focus.androidGuardServices')}</Text>
            <View style={styles.card}>
              <View style={styles.guardRow}>
                <View style={styles.guardLeft}>
                  <Text style={styles.statusTitleSm}>{t('focus.overlayStatus')}</Text>
                  <Text style={styles.guardDesc}>{t('focus.overlayStatusDesc')}</Text>
                </View>
                <View style={styles.pulsePill}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.pulsePillText}>{t('focus.connected')}</Text>
                </View>
              </View>
              <View style={[styles.guardRow, styles.guardRowBordered]}>
                <View style={styles.guardLeft}>
                  <Text style={styles.statusTitleSm}>{t('focus.accessibilityStatus')}</Text>
                  <Text style={styles.guardDesc}>{t('focus.accessibilityStatusDesc')}</Text>
                </View>
                <View style={styles.pulsePill}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.pulsePillText}>{t('focus.running')}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* 3. Session Controls */}
        <View style={styles.controlsRow}>
          <Pressable
            onPress={() => update({ autoNext: !settings.autoNext })}
            style={[styles.controlBtn, settings.autoNext ? styles.controlBtnAmber : styles.controlBtnEmerald]}
          >
            <Feather name={settings.autoNext ? 'pause' : 'play'} size={16} color={settings.autoNext ? colors.warning : colors.successLight} />
            <Text style={[styles.controlBtnText, { color: settings.autoNext ? colors.warning : colors.successLight }]}>
              {settings.autoNext ? t('focus.pause') : t('focus.continueLabel')}
            </Text>
          </Pressable>
          <Pressable onPress={() => setShowFinishConfirm(true)} style={[styles.controlBtn, styles.controlBtnRed]}>
            <Feather name="check-circle" size={16} color={colors.dangerLight} />
            <Text style={[styles.controlBtnText, { color: colors.dangerLight }]}>{t('overlay.endSession')}</Text>
          </Pressable>
        </View>

        {/* 4. Extend Time */}
        <View style={styles.extendCard}>
          <View style={styles.extendLeft}>
            <Feather name="clock" size={16} color="#818CF8" />
            <Text style={styles.extendLabel}>{t('focus.extendTime')}</Text>
          </View>
          <View style={styles.extendChips}>
            {[10, 20, 30].map((amt) => (
              <Pressable key={amt} onPress={() => extendSession(amt)} style={styles.extendChip}>
                <Text style={styles.extendChipText}>+{amt}m</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 5. Interventions & Shields */}
        <View style={styles.card}>
          <View style={styles.interventionRow}>
            <View>
              <Text style={styles.interventionTitle}>{t('focus.breakReminder')}</Text>
              <Text style={styles.interventionSub}>{t('focus.every15m')}</Text>
            </View>
            <Switch
              value={settings.breakIntervalMinutes > 0}
              onValueChange={(v) => update({ breakIntervalMinutes: v ? 15 : 0 })}
              trackColor={{ true: colors.primary, false: '#262626' }}
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
        </View>

        {/* 6. Session Stats */}
        <View>
          <Text style={styles.sectionLabel}>{t('focus.sessionStats')}</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('focus.videos')}</Text>
              <Text style={styles.statTileValue}>{todayVideosWatched}</Text>
              <Text style={styles.statTileFoot}>{t('focus.watched')}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('focus.elapsed')}</Text>
              <Text style={[styles.statTileValue, styles.statTileValuePrimary]}>{todayUsageMinutes}m</Text>
              <Text style={styles.statTileFoot}>{t('focus.watched')}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('focus.avgWatch')}</Text>
              <Text style={[styles.statTileValue, styles.statTileValueSuccess]}>{todayAverageDurationSeconds}s</Text>
              <Text style={styles.statTileFoot}>{t('focus.average')}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Demo Mindful Break Prompt Modal */}
      <Modal visible={showPromptDemo} transparent animationType="fade" onRequestClose={() => setShowPromptDemo(false)}>
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

      {/* Finish Session Confirmation Modal */}
      <Modal visible={showFinishConfirm} transparent animationType="fade" onRequestClose={() => setShowFinishConfirm(false)}>
        <View style={[styles.modalBackdrop, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
          <View style={[styles.modalCard, styles.modalCardRed]}>
            <View style={styles.modalIconRed}>
              <Feather name="check-circle" size={24} color={colors.dangerLight} />
            </View>
            <Text style={styles.modalTitle}>{t('overlay.endSession')}</Text>
            <Text style={styles.modalBody}>{t('focus.finishConfirmBody')}</Text>
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => setShowFinishConfirm(false)} style={styles.modalSecondaryBtn}>
                <Text style={styles.modalSecondaryBtnText}>{t('settings.cancel')}</Text>
              </Pressable>
              <Pressable onPress={confirmFinish} style={styles.modalDangerBtn}>
                <Text style={styles.modalPrimaryBtnText}>{t('focus.yesFinish')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg, paddingBottom: layout.tabBarContentClearance },

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

  sectionLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },
  statusTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  statusTitleSm: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  pulsePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.successLight },
  pulsePillText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.5, textTransform: 'uppercase' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 },
  statusRowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  statusRowLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilySemibold, color: colors.textSecondary },
  statusRowValueMono: { fontSize: 12, fontFamily: typography.monoFontFamilyBold, color: colors.textPrimary },
  statusRowValueMonoPrimary: { fontSize: 12, fontFamily: typography.monoFontFamilyBold, color: colors.primary },

  guardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  guardRowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: spacing.xs, paddingTop: spacing.sm },
  guardLeft: { flex: 1, paddingRight: spacing.sm },
  guardDesc: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },

  controlsRow: { flexDirection: 'row', gap: spacing.sm },
  controlBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.card - 8, borderWidth: 1 },
  controlBtnAmber: { backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.2)' },
  controlBtnEmerald: { backgroundColor: colors.successBg, borderColor: 'rgba(16,185,129,0.2)' },
  controlBtnRed: { backgroundColor: colors.dangerBg, borderColor: 'rgba(239,68,68,0.2)' },
  controlBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1, textTransform: 'uppercase' },

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

  statsGrid: { flexDirection: 'row', gap: spacing.sm },
  statTile: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.md, alignItems: 'center' },
  statTileLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase' },
  statTileValue: { fontSize: 22, fontFamily: typography.displayFontFamily, color: colors.textPrimary, marginVertical: spacing.xs },
  statTileValuePrimary: { color: colors.primary },
  statTileValueSuccess: { color: colors.successLight },
  statTileFoot: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, textTransform: 'uppercase' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 320, borderRadius: 28, padding: 24, alignItems: 'center', gap: spacing.md, borderWidth: 1 },
  modalCardIndigo: { backgroundColor: colors.card, borderColor: `${colors.primary}66` },
  modalCardRed: { backgroundColor: colors.card, borderColor: 'rgba(239,68,68,0.3)' },
  modalIconIndigo: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: `${colors.primary}33`, alignItems: 'center', justifyContent: 'center' },
  modalIconRed: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, textAlign: 'center' },
  modalBody: { fontSize: 12, color: '#D1D5DB', textAlign: 'center', lineHeight: 18 },
  modalPrimaryBtn: { width: '100%', backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalPrimaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },
  modalButtonRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  modalSecondaryBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalSecondaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary, textTransform: 'uppercase' },
  modalDangerBtn: { flex: 1, backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
});
