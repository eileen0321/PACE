import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { formatRemaining } from './shared/formatRemaining';
import { OVERLAY_BAR_HEIGHT, type OverlayBarProps } from './shared/OverlayBar.types';
import { useTranslation } from '../../services/i18n';

// iOS = 사각 "프레임" 배너. Android의 떠 있는 알약과 의도적으로 다른 형태를 쓴다 — iOS는 다른 앱
// 위에 진짜 시스템 오버레이를 띄울 수 없고(실기기에서는 ActivityKit Live Activity/Dynamic Island가
// 잠금화면·아일랜드에 대신 표시), 이 컴포넌트는 Pace 앱이 포그라운드일 때만 보이는 인앱 폴백이다.
// 형태(여백 없는 사각 프레임 vs 여백 있는 알약)로 "이건 시스템 오버레이가 아니라 앱 내부 프레임"이라는
// 차이를 시각적으로도 드러낸다. Auto Next 토글은 없음(supportsAutoNext=false, capability 플래그).
export function OverlayBar({ remainingMinutes, onToggleExpanded }: OverlayBarProps) {
  const { t } = useTranslation();
  return (
    <Pressable style={styles.frame} onPress={onToggleExpanded} accessibilityRole="button" accessibilityLabel="Pace status">
      <View style={styles.accent} />
      <View style={styles.content}>
        <View style={styles.left}>
          <Text style={styles.title}>Pace</Text>
          <Text style={styles.remaining}>⏱ {formatRemaining(remainingMinutes)}</Text>
        </View>
        <Text style={styles.hint}>{t('overlay.tapForDetails')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  accent: { height: 3, backgroundColor: colors.primary, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  content: {
    height: OVERLAY_BAR_HEIGHT - 3,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontWeight: '800', color: colors.textPrimary, fontSize: 12 },
  remaining: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  hint: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
});
