import { useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';
import type { DailyStats } from '../../types/models';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// healthy-shorts-assistant(2) components/WeeklyGraph.tsx를 토씨 하나 안 틀리고 그대로 이식 — App.tsx의
// Stats 탭(activeTab==="stats")이 StatsTab 뒤에 이 컴포넌트를 별도 카드로 덧붙인다(App.tsx:498-508,
// "Weekly Usage Graph" 하드코딩 영어 제목의 바깥 카드 안에 이 컴포넌트 자신의 카드가 한 번 더
// 중첩됨 — 이중 카드가 원본 그대로의 구조). 2026-07-18: 이전 세션에 "다른 프로토타입에서 온
// 컴포넌트"로 잘못 판단해 삭제했었는데, 실제로는 App.tsx:32/503에서 진짜로 쓰이는 실제 컴포넌트였다
// — 원본 재확인 후 복원. 데이터 소스는 원본의 고정 mock 배열 대신 useStatsStore().weeklyStats(SQLite
// 집계)를 일~토 7칸으로 0-채움해서 사용.
function buildWeekArray(weeklyStats: DailyStats[], todayStr: string): { day: string; minutes: number }[] {
  const byDate = new Map(weeklyStats.map((d) => [d.date, d.totalMinutes]));
  const today = new Date(todayStr + 'T00:00:00');
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  return DAY_NAMES.map((name, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return { day: name, minutes: byDate.get(key) ?? 0 };
  });
}

export function WeeklyGraphCard({ weeklyStats }: { weeklyStats: DailyStats[] }) {
  const [selectedDay, setSelectedDay] = useState<{ day: string; minutes: number } | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentDayIndex = new Date(todayStr + 'T00:00:00').getDay();
  const todayName = DAY_NAMES[currentDayIndex];
  const weeklyData = buildWeekArray(weeklyStats, todayStr);
  const maxMinutes = Math.max(...weeklyData.map((d) => d.minutes), 60);
  const weeklyAvg = Math.round(weeklyData.reduce((acc, d) => acc + d.minutes, 0) / 7);

  return (
    <View>
      <Text style={styles.outerTitle}>Weekly Usage Graph</Text>
      <View style={styles.outerCard}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View>
              <View style={styles.titleRow}>
                <Feather name="calendar" size={13} color={colors.primary} />
                <Text style={styles.title}>Weekly Average</Text>
              </View>
              <View style={styles.avgRow}>
                <Text style={styles.avgValue}>{weeklyAvg}</Text>
                <Text style={styles.avgUnit}>min</Text>
                <View style={styles.healthyBadge}>
                  <Feather name="trending-up" size={11} color={colors.successLight} />
                  <Text style={styles.healthyText}>Healthy</Text>
                </View>
              </View>
            </View>
            <View style={styles.tooltipWrap}>
              {selectedDay ? (
                <View style={styles.tooltip}>
                  <Text style={styles.tooltipText}>
                    {selectedDay.day}: <Text style={styles.tooltipStrong}>{selectedDay.minutes} min</Text>
                  </Text>
                </View>
              ) : (
                <Text style={styles.tapHint}>Tap a bar for details</Text>
              )}
            </View>
          </View>

          <View style={styles.chartRow}>
            {weeklyData.map((d) => {
              const isToday = d.day === todayName;
              const isSelected = selectedDay?.day === d.day;
              const heightPct = Math.max(8, (d.minutes / maxMinutes) * 100);
              return (
                <Pressable key={d.day} style={styles.barCol} onPress={() => setSelectedDay(d)}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        { height: `${heightPct}%` },
                        isToday ? styles.barToday : isSelected ? styles.barSelected : styles.barDefault,
                      ]}
                    />
                  </View>
                  <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{d.day.slice(0, 1)}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              <View style={styles.dot} />
              <Text style={styles.footerText}>Today ({todayName})</Text>
            </View>
            <Text style={styles.footerText}>Goal: Under 60 min</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerTitle: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, paddingHorizontal: 4 },
  outerCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: 24, padding: 20 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 24, padding: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: '#8E8E93', letterSpacing: 1, textTransform: 'uppercase' },
  avgRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: spacing.xs },
  avgValue: { fontSize: 30, fontFamily: typography.displayFontFamily, color: colors.textPrimary, letterSpacing: -0.5 },
  avgUnit: { fontSize: 16, fontFamily: typography.bodyFontFamilyBold, color: '#8E8E93' },
  healthyBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.1)', borderRadius: radius.pill, paddingHorizontal: spacing.xs + 2, paddingVertical: 2, marginLeft: spacing.xs },
  healthyText: { fontSize: 11, fontFamily: typography.bodyFontFamilyBold, color: colors.successLight },
  tooltipWrap: { height: 40, justifyContent: 'center' },
  tooltip: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  tooltipText: { fontSize: 10, color: '#8E8E93', fontFamily: typography.bodyFontFamilyBold },
  tooltipStrong: { color: colors.primary, fontFamily: typography.monoFontFamilyBold, fontSize: 12 },
  tapHint: { fontSize: 11, color: '#8E8E93', fontFamily: typography.bodyFontFamilySemibold },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 112, paddingTop: spacing.md, gap: 10 },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: '100%', height: 80, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', borderRadius: radius.chip, minHeight: 4 },
  barToday: { backgroundColor: colors.primary },
  barSelected: { backgroundColor: '#818CF8' },
  barDefault: { backgroundColor: 'rgba(255,255,255,0.1)' },
  dayLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyBold, color: '#8E8E93', marginTop: spacing.xs },
  dayLabelToday: { color: colors.primary, fontFamily: typography.bodyFontFamilyExtrabold },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: spacing.sm + 4, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  footerText: { fontSize: 11, fontFamily: typography.bodyFontFamilySemibold, color: '#8E8E93' },
});
