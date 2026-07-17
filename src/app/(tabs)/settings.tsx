import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../../store/useUserStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing } from '../../constants/theme';
import type { UserSettings } from '../../types/models';

const LANGUAGE_OPTIONS: { value: UserSettings['language']; labelKey: 'settings.languageSystem' | 'settings.languageEnglish' | 'settings.languageKorean' }[] = [
  { value: 'system', labelKey: 'settings.languageSystem' },
  { value: 'en', labelKey: 'settings.languageEnglish' },
  { value: 'ko', labelKey: 'settings.languageKorean' },
];

// healthy-shorts-assistant의 SettingsTab.tsx 포팅: 프로필 카드 / 구독 플랜 선택 / 앱 환경설정+개발자
// 도구 / 지원 + 언어 설정(jlpt-master LangProvider 패턴 이식, PACE_ARCHITECTURE.md i18n 섹션 참고).
// "Reset All App Data"는 원본이 로컬스토리지 리셋이었던 것을 실제 로그아웃+SQLite 초기화로 대체
// (services/storage/keys.ts의 USER_SCOPED_KEYS 사용, PACE_ARCHITECTURE.md DB 스키마 섹션 참고).
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const logout = useUserStore((s) => s.logout);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const isReviewer = useSubscriptionStore((s) => s.isReviewer);
  const { settings, update } = useSettingsStore();
  const [pushReminders, setPushReminders] = useState(true);

  const name = (user?.name ?? user?.email?.split('@')[0] ?? t('settings.guestLabel')).trim();
  const initials = name.slice(0, 2).toUpperCase();

  const onReset = () => {
    Alert.alert(t('settings.resetConfirmTitle'), t('settings.resetConfirmMessage'), [
      { text: t('settings.cancel'), style: 'cancel' },
      { text: t('settings.reset'), style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>{t('settings.screenTitle')}</Text>

        <View style={[styles.card, styles.profileCard]}>
          <View style={styles.profileLeft}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View>
              <Text style={styles.profileName}>{name}</Text>
              <Text style={styles.profileEmail}>{user?.isGuest ? t('settings.guestLabel') : user?.email ?? '-'}</Text>
            </View>
          </View>
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>{isPremium ? (isReviewer ? 'REVIEWER' : t('settings.proMember')) : t('settings.free')}</Text>
          </View>
        </View>

        <Section title={t('settings.planSection')}>
          <Pressable style={styles.card} onPress={() => router.push('/paywall')}>
            <View style={styles.planRow}>
              <Feather name={isPremium ? 'check-circle' : 'circle'} size={20} color={isPremium ? colors.primary : colors.border} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t('settings.planTitle')}</Text>
                <Text style={styles.rowSubtitle}>{t('settings.planDesc')}</Text>
              </View>
            </View>
          </Pressable>
        </Section>

        <Section title={t('settings.languageSection')}>
          <View style={styles.card}>
            <View style={styles.languageRow}>
              {LANGUAGE_OPTIONS.map((opt) => {
                const active = settings.language === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => update({ language: opt.value })}
                    style={[styles.languageChip, active && styles.languageChipActive]}
                  >
                    <Text style={[styles.languageChipText, active && styles.languageChipTextActive]}>{t(opt.labelKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Section>

        <Section title={t('settings.prefsSection')}>
          <View style={styles.card}>
            <View style={styles.row}>
              <View>
                <Text style={styles.rowTitle}>{t('settings.pushReminders')}</Text>
                <Text style={styles.rowSubtitle}>{t('settings.pushRemindersDesc')}</Text>
              </View>
              <Switch value={pushReminders} onValueChange={setPushReminders} trackColor={{ true: colors.primary, false: colors.border }} />
            </View>
            <Pressable onPress={onReset} style={styles.rowLast}>
              <View>
                <Text style={[styles.rowTitle, { color: colors.danger }]}>{t('settings.resetData')}</Text>
                <Text style={styles.rowSubtitle}>{t('settings.resetDataDesc')}</Text>
              </View>
              <Feather name="refresh-cw" size={16} color={colors.danger} />
            </Pressable>
          </View>
        </Section>

        <Section title={t('settings.supportSection')}>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{t('settings.supportAlgorithm')}</Text>
              <Feather name="chevron-right" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{t('settings.supportFeedback')}</Text>
              <Feather name="chevron-right" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.rowLast}>
              <Text style={styles.rowSubtitle}>{t('settings.version')}</Text>
              <Text style={styles.rowSubtitle}>v1.0.0</Text>
            </View>
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: 32 },
  screenTitle: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: spacing.md },
  profileCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  profileName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  profileEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  planBadge: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  planBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  languageRow: { flexDirection: 'row', gap: spacing.sm },
  languageChip: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.chip, backgroundColor: colors.background, alignItems: 'center' },
  languageChipActive: { backgroundColor: colors.primary },
  languageChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  languageChipTextActive: { color: '#FFFFFF' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.background },
  rowLast: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
