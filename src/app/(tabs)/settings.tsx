import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserStore } from '../../store/useUserStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTranslation } from '../../services/i18n';
import { AppHeader } from '../../components/ui/AppHeader';
import { bottomSheetPadding, colors, layout, radius, spacing, typography } from '../../constants/theme';
import type { UserSettings } from '../../types/models';

const LANGUAGE_OPTIONS: { value: UserSettings['language']; labelKey: 'settings.languageSystem' | 'settings.languageEnglish' | 'settings.languageKorean' }[] = [
  { value: 'system', labelKey: 'settings.languageSystem' },
  { value: 'en', labelKey: 'settings.languageEnglish' },
  { value: 'ko', labelKey: 'settings.languageKorean' },
];
const SLEEP_TIMER_OPTIONS = [15, 30, 45, 60, 0];
const DAILY_LIMIT_OPTIONS = [30, 45, 60, 90, 120];
const BREAK_OPTIONS = [10, 15, 20, 30, 0];

function cycle(options: number[], current: number): number {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length];
}

// healthy-shorts-assistant(2) SettingsTab.tsx를 토씨 하나 안 틀리고 그대로 이식(사용자 명시적
// 지시) — Account / Session Defaults / Connected Apps / Platform Configuration / Notifications /
// Privacy / Support / Advanced(Reset) 8섹션. 원본은 Session Defaults를 실제 세션과 무관한 로컬
// 데모 state로 관리했는데, Pace는 애초에 "기본값=실제 설정" 하나뿐이라 useSettingsStore에 직접
// 연결(더 정확한 동작 — 죽은 데모 state를 만들지 않음). "Platform Configuration"의 안드로이드↔iOS
// 전환 버튼은 브라우저 프리뷰용 데모 기능이라 뺐다(실제 앱은 Platform.OS가 고정, 전환할 대상이
// 없음) — 대신 실제 Platform.OS에 맞는 정보만 정직하게 표시. 언어 선택기와 구독/paywall 행은
// Pace 자체 기능이라 유지(원본에 없음).
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useUserStore((s) => s.user);
  const logout = useUserStore((s) => s.logout);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const isReviewer = useSubscriptionStore((s) => s.isReviewer);
  const { settings, update } = useSettingsStore();
  const [notif5m, setNotif5m] = useState(true);
  const [notifLimit, setNotifLimit] = useState(true);
  const [notifBreak, setNotifBreak] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const name = (user?.name ?? user?.email?.split('@')[0] ?? t('settings.guestLabel')).trim();
  const initials = name.slice(0, 2).toUpperCase();

  const confirmReset = () => { setShowResetConfirm(false); logout(); };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>{t('settings.screenTitle')}</Text>

        {/* 1. Account */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.account')}</Text>
          <View style={[styles.card, styles.accountCard]}>
            <View style={styles.accountLeft}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
              <View>
                <View style={styles.nameRow}>
                  <Text style={styles.profileName}>{name.toUpperCase()}</Text>
                  {isPremium && <View style={styles.premiumTag}><Text style={styles.premiumTagText}>{isReviewer ? 'REVIEWER' : t('settings.premium')}</Text></View>}
                </View>
                <Text style={styles.profileEmail}>{user?.isGuest ? t('settings.guestLabel') : user?.email ?? '-'}</Text>
              </View>
            </View>
            <Pressable style={styles.manageSubBtn} onPress={() => router.push('/paywall')}>
              <Text style={styles.manageSubText}>{t('settings.manageSub')}</Text>
              <Feather name="chevron-right" size={14} color="#818CF8" />
            </Pressable>
          </View>
        </View>

        {/* 2. Session Defaults — Pace는 데모 로컬 state 대신 실제 useSettingsStore에 직결 */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.sessionDefaults')}</Text>
          <View style={styles.card}>
            <DefaultRow
              title={t('settings.defaultSleep')} desc={t('settings.defaultSleepDesc')}
              value={settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : t('focus.off')}
              onPress={() => update({ sleepTimerMinutes: cycle(SLEEP_TIMER_OPTIONS, settings.sleepTimerMinutes ?? 0) || null })}
            />
            <DefaultRow
              title={t('settings.defaultLimit')} desc={t('settings.defaultLimitDesc')}
              value={`${settings.dailyLimitMinutes}m`} bordered
              onPress={() => update({ dailyLimitMinutes: cycle(DAILY_LIMIT_OPTIONS, settings.dailyLimitMinutes) })}
            />
            <DefaultRow
              title={t('settings.defaultBreak')} desc={t('settings.defaultBreakDesc')}
              value={settings.breakIntervalMinutes ? `${settings.breakIntervalMinutes}m` : t('focus.off')} bordered
              onPress={() => update({ breakIntervalMinutes: cycle(BREAK_OPTIONS, settings.breakIntervalMinutes) })}
            />
          </View>
        </View>

        {/* 3. Connected Apps — 실제 appShields 상태 반영 */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.connectedApps')}</Text>
          <View style={styles.card}>
            <ConnectedAppRow label={t('home.youtubeShorts')} active={settings.appShields.youtube} />
            <ConnectedAppRow label={t('home.instagramReels')} active={settings.appShields.instagram} bordered />
            <ConnectedAppRow label={t('home.tiktokVideoLoop')} active={settings.appShields.tiktok} bordered />
          </View>
        </View>

        {/* 4. Platform Configuration — 실제 Platform.OS 고정 표시(데모 토글 버튼 제외) */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.platform')}</Text>
          <View style={styles.card}>
            <View style={styles.platformRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{Platform.OS === 'android' ? t('settings.overlayAssistant') : t('settings.pacePlayer')}</Text>
                <Text style={styles.rowSubtitle}>{Platform.OS === 'android' ? t('settings.overlayAssistantDesc') : t('settings.pacePlayerDesc')}</Text>
              </View>
              <View style={styles.readyTag}><Text style={styles.readyTagText}>{t('settings.ready')}</Text></View>
            </View>
          </View>
        </View>

        {/* 5. Notifications */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.notifications')}</Text>
          <View style={styles.card}>
            <NotifRow title={t('settings.remainingAlert')} desc={t('settings.remainingAlertDesc')} value={notif5m} onChange={setNotif5m} />
            <NotifRow title={t('settings.limitAlert')} desc={t('settings.limitAlertDesc')} value={notifLimit} onChange={setNotifLimit} bordered />
            <NotifRow title={t('focus.breakReminder')} desc={t('settings.breakReminderAlertDesc')} value={notifBreak} onChange={setNotifBreak} bordered />
          </View>
        </View>

        {/* 6. Language (Pace 전용) */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.languageSection')}</Text>
          <View style={styles.card}>
            <View style={styles.languageRow}>
              {LANGUAGE_OPTIONS.map((opt) => {
                const active = settings.language === opt.value;
                return (
                  <Pressable key={opt.value} onPress={() => update({ language: opt.value })} style={[styles.languageChip, active && styles.languageChipActive]}>
                    <Text style={[styles.languageChipText, active && styles.languageChipTextActive]}>{t(opt.labelKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* 7. Support */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.support')}</Text>
          <View style={styles.card}>
            <ChevronRow title={t('settings.helpCenter')} />
            <ChevronRow title={t('settings.sendFeedback')} bordered />
            <ChevronRow title={t('settings.rateApp')} bordered />
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.versionLabel}>{t('settings.version')}</Text>
              <Text style={styles.versionValue}>1.0.0</Text>
            </View>
          </View>
        </View>

        {/* 8. Advanced — Reset */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.advanced')}</Text>
          <View style={[styles.card, styles.advancedCard]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resetTitle}>{t('settings.resetSettings')}</Text>
              <Text style={styles.rowSubtitle}>{t('settings.resetSettingsDesc')}</Text>
            </View>
            <Pressable style={styles.resetIconBtn} onPress={() => setShowResetConfirm(true)}>
              <Feather name="refresh-cw" size={16} color={colors.dangerLight} />
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Modal visible={showResetConfirm} transparent animationType="fade" onRequestClose={() => setShowResetConfirm(false)}>
        <View style={[styles.modalBackdrop, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('settings.resetSettings')}</Text>
            <Text style={styles.modalBody}>{t('settings.resetConfirmMessage')}</Text>
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => setShowResetConfirm(false)} style={styles.modalSecondaryBtn}>
                <Text style={styles.modalSecondaryBtnText}>{t('settings.cancel')}</Text>
              </Pressable>
              <Pressable onPress={confirmReset} style={styles.modalDangerBtn}>
                <Text style={styles.modalPrimaryBtnText}>{t('settings.resetNow')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DefaultRow({ title, desc, value, onPress, bordered }: { title: string; desc: string; value: string; onPress: () => void; bordered?: boolean }) {
  return (
    <View style={[styles.row, bordered && styles.rowBordered]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{desc}</Text>
      </View>
      <Pressable onPress={onPress} style={styles.valuePill}>
        <Text style={styles.valuePillText}>{value}</Text>
        <Feather name="chevron-right" size={14} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function ConnectedAppRow({ label, active, bordered }: { label: string; active: boolean; bordered?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, bordered && styles.rowBordered]}>
      <Text style={styles.rowTitle}>{label}</Text>
      <View style={[styles.statusTag, !active && styles.statusTagOff]}>
        <Text style={[styles.statusTagText, !active && styles.statusTagTextOff]}>{active ? t('settings.active') : t('focus.off')}</Text>
      </View>
    </View>
  );
}

function NotifRow({ title, desc, value, onChange, bordered }: { title: string; desc: string; value: boolean; onChange: (v: boolean) => void; bordered?: boolean }) {
  return (
    <View style={[styles.row, bordered && styles.rowBordered]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{desc}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: '#262626' }} thumbColor="#FFFFFF" ios_backgroundColor="#262626" />
    </View>
  );
}

function ChevronRow({ title, bordered }: { title: string; bordered?: boolean }) {
  return (
    <View style={[styles.row, bordered && styles.rowBordered]}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Feather name="chevron-right" size={16} color={colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg, paddingBottom: layout.tabBarContentClearance },
  screenTitle: { fontSize: 24, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  sectionLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.lg },
  accountCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, flex: 1 },
  avatar: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: `${colors.primary}4D`, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontFamily: typography.displayFontFamily, fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  profileName: { fontSize: 15, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, letterSpacing: -0.2 },
  premiumTag: { backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  premiumTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.primary, letterSpacing: 0.5 },
  profileEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontFamily: typography.bodyFontFamilyMedium },
  manageSubBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  manageSubText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#818CF8' },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm + 4 },
  rowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: 2, paddingTop: spacing.md },
  rowLast: { marginTop: 2, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.md },
  rowTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  rowSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  valuePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 6 },
  valuePillText: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: '#818CF8' },

  statusTag: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.1)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  statusTagOff: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: colors.borderSubtle },
  statusTagText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.5, textTransform: 'uppercase' },
  statusTagTextOff: { color: colors.textSecondary },

  platformRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  readyTag: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.1)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  readyTagText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.5, textTransform: 'uppercase' },

  languageRow: { flexDirection: 'row', gap: spacing.sm },
  languageChip: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.chip, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center' },
  languageChipActive: { backgroundColor: colors.primary },
  languageChipText: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  languageChipTextActive: { color: '#FFFFFF' },

  versionLabel: { fontSize: 11, fontFamily: typography.monoFontFamily, color: colors.textSecondary },
  versionValue: { fontSize: 11, fontFamily: typography.monoFontFamily, color: colors.textSecondary },

  advancedCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resetTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.dangerLight },
  resetIconBtn: { width: 36, height: 36, borderRadius: radius.chip, backgroundColor: colors.dangerBg, alignItems: 'center', justifyContent: 'center' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 28, padding: 24, alignItems: 'center', gap: spacing.md },
  modalTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  modalBody: { fontSize: 12, color: '#D1D5DB', textAlign: 'center', lineHeight: 18 },
  modalButtonRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  modalSecondaryBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalSecondaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary, textTransform: 'uppercase' },
  modalDangerBtn: { flex: 1, backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalPrimaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },
});
