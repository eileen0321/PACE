import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';
import type { DailyStats } from '../../types/models';

function dayLetter(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()];
}

// healthy-shorts-assistant의 WeeklyGraph.tsx 포팅. 데이터 소스는 웹 프로토타입의 목업 배열 대신
// useStatsStore().weeklyStats(SQLite 집계)를 사용 — 요일 라벨/오늘 판정 로직만 그대로 이식.
export function WeeklyGraphCard({ weeklyStats }: { weeklyStats: DailyStats[] }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<DailyStats | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const maxMinutes = Math.max(60, ...weeklyStats.map((d) => d.totalMinutes));
  const avg = weeklyStats.length ? Math.round(weeklyStats.reduce((acc, d) => acc + d.totalMinutes, 0) / weeklyStats.length) : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View>
            <View style={styles.titleRow}>
              <Feather name="calendar" size={13} color={colors.primary} />
              <Text style={styles.title}>{t('home.weeklyAvgTitle')}</Text>
            </View>
            <View style={styles.avgRow}>
              <Text style={styles.avgValue}>{avg}</Text>
              <Text style={styles.avgUnit}>{t('home.minUnit')}</Text>
              <View style={styles.healthyBadge}>
                <Feather name="trending-up" size={11} color={colors.success} />
                <Text style={styles.healthyText}>{t('home.healthy')}</Text>
              </View>
            </View>
          </View>
          <View style={styles.tooltipWrap}>
            {selected ? (
              <View style={styles.tooltip}>
                <Text style={styles.tooltipText}>
                  {selected.date.slice(5)}: <Text style={styles.tooltipStrong}>{selected.totalMinutes} {t('home.minUnit')}</Text>
                </Text>
              </View>
            ) : (
              <Text style={styles.tapHint}>{t('home.tapBarHint')}</Text>
            )}
          </View>
        </View>

        <View style={styles.chartRow}>
          {weeklyStats.map((d) => {
            const isToday = d.date === todayStr;
            const isSelected = selected?.date === d.date;
            const heightPct = Math.max(8, (d.totalMinutes / maxMinutes) * 100);
            return (
              <Pressable key={d.date} style={styles.barCol} onPress={() => setSelected(d)}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      { height: `${heightPct}%` },
                      isToday ? styles.barToday : isSelected ? styles.barSelected : styles.barDefault,
                    ]}
                  />
                </View>
                <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{dayLetter(d.date)}</Text>
              </Pressable>
            );
          })}
          {weeklyStats.length === 0 && <Text style={styles.empty}>{t('home.noRecords')}</Text>}
        </View>

        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <View style={styles.dot} />
            <Text style={styles.footerText}>{t('home.today')}</Text>
          </View>
          <Text style={styles.footerText}>{t('home.goalUnder', { n: 60 })}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1 },
  avgRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: spacing.xs },
  avgValue: { fontSize: 30, fontWeight: '800', color: colors.textPrimary },
  avgUnit: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  healthyBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.successBg, borderRadius: radius.pill, paddingHorizontal: spacing.xs, paddingVertical: 2, marginLeft: spacing.xs },
  healthyText: { fontSize: 11, fontWeight: '700', color: colors.success },
  tooltipWrap: { height: 32, justifyContent: 'center' },
  tooltip: { backgroundColor: colors.cardMuted, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  tooltipText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  tooltipStrong: { color: colors.primary, fontWeight: '700' },
  tapHint: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: spacing.sm },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: '100%', flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: radius.chip, minHeight: 4 },
  barToday: { backgroundColor: colors.primary },
  barSelected: { backgroundColor: '#8180E0' },
  barDefault: { backgroundColor: colors.border },
  dayLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.xs },
  dayLabelToday: { color: colors.primary, fontWeight: '800' },
  empty: { color: colors.textSecondary, fontSize: 12 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.background },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  footerText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
});
