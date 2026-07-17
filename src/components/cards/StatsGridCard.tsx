import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';
import type { UserSettings } from '../../types/models';

// healthy-shorts-assistant의 StatsGrid.tsx 포팅 — 2열 통계 + Focus 탭으로 이동하는 설정 요약 배너.
export function StatsGridCard({ videosWatched, averageDurationSec, settings, onPressSettings }: {
  videosWatched: number;
  averageDurationSec: number;
  settings: UserSettings;
  onPressSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.grid}>
          <View style={styles.cell}>
            <Text style={styles.cellValue}>{videosWatched}</Text>
            <Text style={styles.cellLabel}>{t('home.videosWatchedToday')}</Text>
          </View>
          <View style={[styles.cell, styles.cellBorder]}>
            <View style={styles.durationRow}>
              <Text style={styles.cellValue}>{averageDurationSec}</Text>
              <Text style={styles.durationUnit}>{t('home.sec')}</Text>
            </View>
            <Text style={styles.cellLabel}>{t('home.averageDuration')}</Text>
          </View>
        </View>

        <Pressable onPress={onPressSettings} style={styles.banner}>
          <View style={styles.bannerLeft}>
            <Feather name="sliders" size={14} color={colors.primary} />
            <Text style={styles.bannerText} numberOfLines={1}>
              {t('home.bannerAutoNext')}: <Text style={styles.bannerStrong}>{settings.autoNext ? 'ON' : 'OFF'}</Text>
              {'  •  '}{t('home.bannerSleep')}: <Text style={styles.bannerStrongMuted}>{settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : 'OFF'}</Text>
              {'  •  '}{t('home.bannerLimit')}: <Text style={styles.bannerStrongMuted}>{settings.dailyLimitMinutes}m</Text>
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  card: { backgroundColor: colors.cardMuted, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, overflow: 'hidden' },
  grid: { flexDirection: 'row' },
  cell: { flex: 1, padding: spacing.lg },
  cellBorder: { borderLeftWidth: 1, borderLeftColor: colors.border },
  cellValue: { fontSize: 30, fontWeight: '700', color: colors.textPrimary },
  durationRow: { flexDirection: 'row', alignItems: 'baseline' },
  durationUnit: { fontSize: 16, color: colors.textSecondary, marginLeft: 4 },
  cellLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 4 },
  banner: { backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  bannerText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, flex: 1 },
  bannerStrong: { color: colors.primary, fontWeight: '700' },
  bannerStrongMuted: { color: colors.textPrimary, fontWeight: '700' },
});
