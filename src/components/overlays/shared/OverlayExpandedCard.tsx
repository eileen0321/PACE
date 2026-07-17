import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../../constants/theme';
import { capabilities } from '../../../services/platform';
import { useTranslation } from '../../../services/i18n';
import type { OverlayExpandedInfo } from './OverlayBar.types';

// healthy-shorts-assistant의 ShortsPlayer.tsx "EXPANDED STATE" 카드를 포팅. Android/iOS 공통 —
// 플랫폼 분기 없음(PACE_ARCHITECTURE.md "오버레이 UI 원칙" 참고: 화면 상단 영역에만 머문다).
export function OverlayExpandedCard({
  todayUsedMinutes,
  dailyLimitMinutes,
  remainingMinutes,
  autoNextEnabled,
  onToggleAutoNext,
  sleepTimerMinutes,
  onCycleSleepTimer,
  isPlaying,
  onTogglePlaying,
  onStop,
}: OverlayExpandedInfo) {
  const { t } = useTranslation();
  const progressPct = Math.min(100, Math.round((todayUsedMinutes / Math.max(1, dailyLimitMinutes)) * 100));

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="sliders" size={14} color={colors.primary} />
          <Text style={styles.headerTitle}>{t('overlay.controlsTitle')}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.gridCell}>
          <Text style={styles.gridLabel}>{t('overlay.todayUsage')}</Text>
          <Text style={styles.gridValue}>
            {todayUsedMinutes}m <Text style={styles.gridValueMuted}>/ {dailyLimitMinutes}m</Text>
          </Text>
        </View>
        <View style={styles.gridCell}>
          <Text style={styles.gridLabel}>{t('overlay.remaining')}</Text>
          <Text style={[styles.gridValue, { color: colors.primary }]}>{remainingMinutes}m</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>
      <View style={styles.progressLabels}>
        <Text style={styles.progressLabel}>{t('overlay.watched', { n: progressPct })}</Text>
        <Text style={styles.progressLabel}>{t('overlay.left', { n: 100 - progressPct })}</Text>
      </View>

      {capabilities.supportsAutoNext && (
        <Row
          title={t('focus.autoNext')}
          description={t('overlay.autoNextDesc')}
          right={
            <Pressable onPress={onToggleAutoNext} style={[styles.pill, autoNextEnabled && styles.pillActive]}>
              <Text style={[styles.pillText, autoNextEnabled && styles.pillTextActive]}>{autoNextEnabled ? 'ON' : 'OFF'}</Text>
            </Pressable>
          }
        />
      )}
      <Row
        title={t('focus.sleepTimer')}
        description={t('overlay.sleepTimerDesc')}
        right={
          <Pressable onPress={onCycleSleepTimer} style={styles.pill}>
            <Text style={styles.pillText}>{sleepTimerMinutes ? `${sleepTimerMinutes}m` : 'OFF'}</Text>
          </Pressable>
        }
      />

      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={onTogglePlaying}>
          <Feather name={isPlaying ? 'pause' : 'play'} size={14} color={colors.textPrimary} />
          <Text style={styles.actionText}>{isPlaying ? t('overlay.pauseSession') : t('overlay.resume')}</Text>
        </Pressable>
        <Pressable style={[styles.actionBtn, styles.stopBtn]} onPress={onStop}>
          <Feather name="log-out" size={14} color={colors.danger} />
          <Text style={[styles.actionText, styles.stopText]}>{t('overlay.endSession')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({ title, description, right }: { title: string; description: string; right: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.cardLarge, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 11, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1 },
  grid: { flexDirection: 'row', gap: spacing.sm },
  gridCell: { flex: 1, backgroundColor: colors.background, borderRadius: radius.chip, padding: spacing.sm },
  gridLabel: { fontSize: 9, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 },
  gridValue: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  gridValueMuted: { fontSize: 11, fontWeight: '400', color: colors.textSecondary },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.background, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowText: { flex: 1, paddingRight: spacing.sm },
  rowTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  rowDesc: { fontSize: 10, color: colors.textSecondary, marginTop: 1 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.background },
  pillActive: { backgroundColor: colors.primary },
  pillText: { fontSize: 10, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5 },
  pillTextActive: { color: '#FFFFFF' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm + 2, borderRadius: radius.chip, backgroundColor: colors.background },
  stopBtn: { backgroundColor: colors.dangerBg },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  stopText: { color: colors.danger },
});
