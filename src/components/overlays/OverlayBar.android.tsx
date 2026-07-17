import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../constants/theme';
import { formatRemaining } from './shared/formatRemaining';
import { OVERLAY_BAR_HEIGHT, type OverlayBarProps } from './shared/OverlayBar.types';

// Android = 떠 있는 알약(pill) 모양 오버레이. 실제 화면에서는 TYPE_APPLICATION_OVERLAY(구버전) 또는
// Bubbles API(Android 17+, PACE_ARCHITECTURE.md "최신 플랫폼 트렌드 반영" 참고) 네이티브 윈도우 안에
// 이 컴포넌트가 렌더된다. 여기서는 in-app 미리보기/개발용 세션 화면 재사용 목적의 순수 UI.
// 원칙: 상시 노출은 이 얇은 바 하나뿐 — healthy-shorts-assistant의 ShortsPlayer.tsx 컴팩트 상태를 이식.
export function OverlayBar({ remainingMinutes, autoNextEnabled, onToggleAutoNext, onToggleExpanded }: OverlayBarProps) {
  return (
    <Pressable style={styles.bar} onPress={onToggleExpanded} accessibilityRole="button" accessibilityLabel="Pace overlay">
      <View style={styles.left}>
        <View style={styles.dot} />
        <Text style={styles.title}>Pace</Text>
        <Text style={styles.remaining}>⏱ {formatRemaining(remainingMinutes)}</Text>
      </View>
      <Pressable
        onPress={onToggleAutoNext}
        style={[styles.autoPill, autoNextEnabled ? styles.autoOn : styles.autoOff]}
        hitSlop={8}
      >
        <Text style={[styles.autoText, !autoNextEnabled && styles.autoTextOff]}>{autoNextEnabled ? 'AUTO ON' : 'AUTO OFF'}</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: OVERLAY_BAR_HEIGHT,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: radius.cardLarge,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  title: { fontWeight: '800', color: colors.textPrimary, fontSize: 12 },
  remaining: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  autoPill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill },
  autoOn: { backgroundColor: colors.primary },
  autoOff: { backgroundColor: 'rgba(0,0,0,0.05)' },
  autoText: { color: '#FFFFFF', fontWeight: '800', fontSize: 10, letterSpacing: 0.5 },
  autoTextOff: { color: colors.textSecondary },
});
