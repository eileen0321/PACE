import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../../store/useUserStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { colors, radius, spacing } from '../../constants/theme';

// healthy-shorts-assistant의 SettingsTab.tsx 포팅: 프로필 카드 / 구독 플랜 선택 / 앱 환경설정+개발자
// 도구 / 지원. "Reset All App Data"는 원본이 로컬스토리지 리셋이었던 것을 실제 로그아웃+SQLite 초기화로
// 대체(services/storage/keys.ts의 USER_SCOPED_KEYS 사용, PACE_ARCHITECTURE.md DB 스키마 섹션 참고).
export default function SettingsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const logout = useUserStore((s) => s.logout);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const [pushReminders, setPushReminders] = useState(true);

  const name = (user?.name ?? user?.email?.split('@')[0] ?? 'Guest').trim();
  const initials = name.slice(0, 2).toUpperCase();

  const onReset = () => {
    Alert.alert('Reset All App Data', 'Clear local storage and reset usage logs?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>Settings</Text>

        <View style={[styles.card, styles.profileCard]}>
          <View style={styles.profileLeft}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View>
              <Text style={styles.profileName}>{name}</Text>
              <Text style={styles.profileEmail}>{user?.isGuest ? '게스트 계정' : user?.email ?? '-'}</Text>
            </View>
          </View>
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>{isPremium ? 'PRO MEMBER' : 'FREE'}</Text>
          </View>
        </View>

        <Section title="Premium Plan Membership">
          <Pressable style={styles.card} onPress={() => router.push('/paywall')}>
            <View style={styles.planRow}>
              <Feather name={isPremium ? 'check-circle' : 'circle'} size={20} color={isPremium ? colors.primary : colors.border} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Pace Premium Plus</Text>
                <Text style={styles.rowSubtitle}>All advanced blockers, shields & unlimited respiration triggers</Text>
              </View>
            </View>
          </Pressable>
        </Section>

        <Section title="App Preferences & Developer Tools">
          <View style={styles.card}>
            <View style={styles.row}>
              <View>
                <Text style={styles.rowTitle}>Push Rest Reminders</Text>
                <Text style={styles.rowSubtitle}>Send break prompts during active browsing</Text>
              </View>
              <Switch value={pushReminders} onValueChange={setPushReminders} trackColor={{ true: colors.primary, false: colors.border }} />
            </View>
            <Pressable onPress={onReset} style={styles.rowLast}>
              <View>
                <Text style={[styles.rowTitle, { color: colors.danger }]}>Reset All App Data</Text>
                <Text style={styles.rowSubtitle}>Clear local storage and reset usage logs</Text>
              </View>
              <Feather name="refresh-cw" size={16} color={colors.danger} />
            </Pressable>
          </View>
        </Section>

        <Section title="Support & Info">
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>How our algorithms prevent doom-scrolling</Text>
              <Feather name="chevron-right" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>Submit feedback & request content</Text>
              <Feather name="chevron-right" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.rowLast}>
              <Text style={styles.rowSubtitle}>Version</Text>
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.background },
  rowLast: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
