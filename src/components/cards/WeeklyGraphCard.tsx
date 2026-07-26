import { useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import type { DailyStats } from '../../types/models';

// 2026-07-26 감사 발견 — 요일 라벨이 자체 영문 배열(SUNDAY_FIRST/MONDAY_FIRST)로 하드코딩돼
// 있었다. dayIndex(0=일~6=토, Date.getDay()와 동일)만 계산하고, 실제 라벨은 기존 stats.daySun..
// daySat 키로 매핑한다(useAttendanceStore의 동일 감사 수정과 같은 패턴).
const MONDAY_FIRST_INDICES = [1, 2, 3, 4, 5, 6, 0]; // 월~일 순서의 dayIndex
const DAY_INDEX_KEYS: TranslationKey[] = [
  'stats.daySun', 'stats.dayMon', 'stats.dayTue', 'stats.dayWed', 'stats.dayThu', 'stats.dayFri', 'stats.daySat',
];

// healthy-shorts-assistant(2) components/WeeklyGraph.tsx를 토씨 하나 안 틀리고 그대로 이식 — App.tsx의
// Stats 탭(activeTab==="stats")이 StatsTab 뒤에 이 컴포넌트를 별도 카드로 덧붙인다(App.tsx:498-508,
// "Weekly Usage Graph" 하드코딩 영어 제목의 바깥 카드 안에 이 컴포넌트 자신의 카드가 한 번 더
// 중첩됨 — 이중 카드가 원본 그대로의 구조). 2026-07-18: 이전 세션에 "다른 프로토타입에서 온
// 컴포넌트"로 잘못 판단해 삭제했었는데, 실제로는 App.tsx:32/503에서 진짜로 쓰이는 실제 컴포넌트였다
// — 원본 재확인 후 복원. 데이터 소스는 원본의 고정 mock 배열 대신 useStatsStore().weeklyStats(SQLite
// 집계)를 일~토 7칸으로 0-채움해서 사용.
function buildWeekArray(weeklyStats: DailyStats[], todayStr: string): { dayIndex: number; minutes: number }[] {
  const byDate = new Map(weeklyStats.map((d) => [d.date, d.totalMinutes]));
  const today = new Date(todayStr + 'T00:00:00');
  // data.ts의 INITIAL_WEEKLY_DATA가 월요일부터 시작(Mon..Sun)이라 막대도 그 순서로 렌더된다 —
  // 일요일 시작으로 잘못 이식했던 걸 수정.
  const monday = new Date(today);
  const isoDow = (today.getDay() + 6) % 7; // 0=Mon..6=Sun
  monday.setDate(today.getDate() - isoDow);
  return MONDAY_FIRST_INDICES.map((dayIndex, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return { dayIndex, minutes: byDate.get(key) ?? 0 };
  });
}

export function WeeklyGraphCard({ weeklyStats }: { weeklyStats: DailyStats[] }) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<{ dayIndex: number; minutes: number } | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentDayIndex = new Date(todayStr + 'T00:00:00').getDay();
  const weeklyData = buildWeekArray(weeklyStats, todayStr);
  const maxMinutes = Math.max(...weeklyData.map((d) => d.minutes), 60);
  const weeklyAvg = Math.round(weeklyData.reduce((acc, d) => acc + d.minutes, 0) / 7);

  return (
    <View>
      <Text style={styles.outerTitle}>{t('stats.weeklyGraphTitle')}</Text>
      <View style={styles.outerCard}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View>
              <View style={styles.titleRow}>
                <Feather name="calendar" size={13} color={colors.primary} />
                <Text style={styles.title}>{t('stats.weeklyAverageLabel')}</Text>
              </View>
              <View style={styles.avgRow}>
                <Text style={styles.avgValue}>{weeklyAvg}</Text>
                <Text style={styles.avgUnit}>{t('home.minUnit')}</Text>
                <View style={styles.healthyBadge}>
                  <Feather name="trending-up" size={11} color={colors.successLight} />
                  <Text style={styles.healthyText}>{t('stats.healthy')}</Text>
                </View>
              </View>
            </View>
            <View style={styles.tooltipWrap}>
              {selectedDay ? (
                <View style={styles.tooltip}>
                  <Text style={styles.tooltipText}>
                    {t(DAY_INDEX_KEYS[selectedDay.dayIndex])}: <Text style={styles.tooltipStrong}>{t('stats.minutesShort', { n: selectedDay.minutes })}</Text>
                  </Text>
                </View>
              ) : (
                <Text style={styles.tapHint}>{t('stats.tapBarHint')}</Text>
              )}
            </View>
          </View>

          <View style={styles.chartRow}>
            {weeklyData.map((d) => {
              const isToday = d.dayIndex === currentDayIndex;
              const isSelected = selectedDay?.dayIndex === d.dayIndex;
              const heightPct = Math.max(8, (d.minutes / maxMinutes) * 100);
              return (
                <Pressable key={d.dayIndex} style={styles.barCol} onPress={() => setSelectedDay(d)}>
                  <View style={styles.barTrack}>
                    <View style={[styles.barHoverRing, isSelected && styles.barHoverRingSelected]} />
                    <View
                      style={[
                        styles.bar,
                        { height: `${heightPct}%` },
                        isToday ? styles.barToday : isSelected ? styles.barSelected : styles.barDefault,
                      ]}
                    />
                  </View>
                  <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{t(DAY_INDEX_KEYS[d.dayIndex]).slice(0, 1)}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              <View style={styles.dot} />
              <Text style={styles.footerText}>{t('stats.todayFooterLabel', { day: t(DAY_INDEX_KEYS[currentDayIndex]) })}</Text>
            </View>
            <Text style={styles.footerText}>{t('stats.goalUnderLabel', { n: 60 })}</Text>
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
  barTrack: { width: '100%', height: 80, justifyContent: 'flex-end', alignItems: 'center', position: 'relative' },
  barHoverRing: { position: 'absolute', left: -2, right: -2, top: -8, bottom: -8, borderRadius: 12, backgroundColor: 'transparent' },
  barHoverRingSelected: { backgroundColor: `${colors.primary}1A` },
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
