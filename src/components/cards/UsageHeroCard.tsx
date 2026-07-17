import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../constants/theme';

// healthy-shorts-assistant의 UsageHero.tsx 포팅. 테스터용 +/-분 조절 버튼은 프로토타입 전용이라 제외.
export function UsageHeroCard({ minutesWatched, limitMinutes }: { minutesWatched: number; limitMinutes: number }) {
  const percentage = Math.min(100, (minutesWatched / Math.max(1, limitMinutes)) * 100);
  const remainingTime = Math.max(0, limitMinutes - minutesWatched);
  const remainingPercentage = Math.round(100 - percentage);

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.label}>TODAY'S USAGE</Text>
        <View style={styles.valueRow}>
          <Text style={styles.value}>{minutesWatched}</Text>
          <Text style={styles.valueUnit}> / {limitMinutes} min</Text>
        </View>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${percentage}%` }]} />
        </View>

        <View style={styles.footer}>
          <View>
            <Text style={styles.footerLabel}>REMAINING</Text>
            {remainingTime > 0 ? (
              <Text style={styles.footerValue}>{remainingTime} min left today</Text>
            ) : (
              <Text style={[styles.footerValue, { color: colors.danger }]}>Daily Limit Reached</Text>
            )}
          </View>
          <View style={styles.pctBadge}>
            <Text style={styles.pctText}>{remainingPercentage}% Left</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: spacing.lg },
  label: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.xs },
  value: { fontSize: 36, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  valueUnit: { fontSize: 16, color: colors.textSecondary, fontWeight: '500' },
  track: { height: 12, backgroundColor: colors.border, borderRadius: radius.pill, overflow: 'hidden', marginTop: spacing.md },
  fill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.background },
  footerLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 },
  footerValue: { fontSize: 15, fontWeight: '700', color: colors.primary, marginTop: 2 },
  pctBadge: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  pctText: { fontSize: 11, fontWeight: '700', color: colors.primary },
});
