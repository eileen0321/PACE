import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '../../store/useUserStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing } from '../../constants/theme';

// healthy-shorts-assistant의 StatsTab.tsx 포팅. "Wholesome Feed Breakdown" 카테고리 비중은
// 원본이 정적 목업 값이었다 — 실제 시청 카테고리 트래킹(뮤직/브레스/스트레치 등 분류)은
// 아직 계측하지 않으므로 TODO로 남기고 레이아웃만 이식.
const CATEGORIES = [
  { key: 'categoryBreath' as const, percentage: 45, icon: 'wind' as const, color: '#F59E0B', bg: '#FEF3E2' },
  { key: 'categoryNature' as const, percentage: 30, icon: 'compass' as const, color: colors.primary, bg: colors.primaryTint },
  { key: 'categoryLearning' as const, percentage: 15, icon: 'book-open' as const, color: '#10B981', bg: '#E6F7F1' },
  { key: 'categoryYoga' as const, percentage: 10, icon: 'heart' as const, color: '#F43F5E', bg: '#FEE7EA' },
];

function computeStreak(weeklyStats: { date: string; totalMinutes: number }[]): number {
  const byDate = new Map(weeklyStats.map((d) => [d.date, d.totalMinutes]));
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 7; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if ((byDate.get(key) ?? 0) > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}

export default function StatsScreen() {
  const { t } = useTranslation();
  const user = useUserStore((s) => s.user);
  const { weeklyStats, refresh } = useStatsStore();

  useEffect(() => {
    if (user?.id) refresh(user.id);
  }, [user?.id, refresh]);

  const totalMinutesThisWeek = weeklyStats.reduce((acc, d) => acc + d.totalMinutes, 0);
  const highestDay = [...weeklyStats].sort((a, b) => b.totalMinutes - a.totalMinutes)[0];
  const streak = computeStreak(weeklyStats);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>{t('stats.screenTitle')}</Text>

        <Section title={t('stats.streakSection')}>
          <View style={[styles.card, styles.streakCard]}>
            <View style={styles.streakLeft}>
              <View style={styles.streakIcon}>
                <Feather name="zap" size={26} color="#F97316" />
              </View>
              <View>
                <Text style={styles.streakValue}>{t('stats.dayStreak', { n: streak })}</Text>
                <Text style={styles.streakDesc}>{t('stats.streakDesc')}</Text>
              </View>
            </View>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>{t('stats.active')}</Text>
            </View>
          </View>
        </Section>

        <Section title={t('stats.wellnessSection')}>
          <View style={styles.card}>
            <Row title={t('stats.weeklyTotal')} subtitle={t('stats.weeklyTotalDesc')} value={`${totalMinutesThisWeek} ${t('home.minUnit')}`} />
            <Row
              title={t('stats.peakDay')}
              subtitle={t('stats.peakDayDesc')}
              value={highestDay ? `${highestDay.date.slice(5)} (${highestDay.totalMinutes}${t('home.minUnit')})` : '-'}
            />
            <View style={styles.rowLast}>
              <View>
                <Text style={styles.rowTitle}>{t('stats.pacingIndex')}</Text>
                <Text style={styles.rowSubtitle}>{t('stats.pacingIndexDesc')}</Text>
              </View>
              <View style={styles.excellentBadge}>
                <Text style={styles.excellentText}>{t('stats.excellent')}</Text>
              </View>
            </View>
          </View>
        </Section>

        <Section title={t('stats.feedBreakdownSection')}>
          <View style={[styles.card, { gap: spacing.md }]}>
            {CATEGORIES.map((cat) => (
              <View key={cat.key} style={{ gap: 6 }}>
                <View style={styles.catRow}>
                  <View style={styles.catLeft}>
                    <View style={[styles.catIcon, { backgroundColor: cat.bg }]}>
                      <Feather name={cat.icon} size={13} color={cat.color} />
                    </View>
                    <Text style={styles.catName}>{t(`stats.${cat.key}`)}</Text>
                  </View>
                  <Text style={styles.catPct}>{cat.percentage}%</Text>
                </View>
                <View style={styles.catTrack}>
                  <View style={[styles.catFill, { width: `${cat.percentage}%` }]} />
                </View>
              </View>
            ))}
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

function Row({ title, subtitle, value }: { title: string; subtitle: string; value: string }) {
  return (
    <View style={styles.row}>
      <View>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
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
  streakCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  streakLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  streakIcon: { width: 48, height: 48, borderRadius: radius.chip, backgroundColor: '#FFF3E8', alignItems: 'center', justifyContent: 'center' },
  streakValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  streakDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  activeBadge: { backgroundColor: '#FFF3E8', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  activeBadgeText: { fontSize: 10, fontWeight: '700', color: '#F97316' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.background },
  rowLast: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  rowValue: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  excellentBadge: { backgroundColor: colors.successBg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  excellentText: { fontSize: 10, fontWeight: '700', color: colors.success },
  catRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  catIcon: { width: 24, height: 24, borderRadius: radius.chip / 2, alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  catPct: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  catTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.background, overflow: 'hidden' },
  catFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },
});
