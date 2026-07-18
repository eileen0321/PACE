import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, floatingShadow, radius, spacing, typography } from '../../constants/theme';
import { formatRemaining } from './shared/formatRemaining';
import { OVERLAY_BAR_HEIGHT, type OverlayBarProps } from './shared/OverlayBar.types';

// Android = 떠 있는 알약(pill) 모양 오버레이. 실제 화면에서는 TYPE_APPLICATION_OVERLAY(구버전) 또는
// Bubbles API(Android 17+, PACE_ARCHITECTURE.md "최신 플랫폼 트렌드 반영" 참고) 네이티브 윈도우 안에
// 이 컴포넌트가 렌더된다. 여기서는 in-app 미리보기/개발용 세션 화면 재사용 목적의 순수 UI.
// 원칙: 상시 노출은 이 얇은 바 하나뿐 — healthy-shorts-assistant의 ShortsPlayer.tsx 컴팩트 상태를 이식.
//
// 2026-07-18: healthy-shorts-assistant(2) 다크 리스킨 — 기존 흰 반투명 유리(bg-white/75)에서
// 검은 반투명 유리(bg-black/60)로 전환. 임의의 영상 콘텐츠 위에 뜨는 요소라 밝기와 무관하게
// 항상 어두운 유리가 가독성이 좋다(원본도 이 이유로 다크 글래스로 리스킨했다).
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
        <Text style={[styles.autoText, !autoNextEnabled && styles.autoTextOff]}>{autoNextEnabled ? 'NEXT ON' : 'NEXT OFF'}</Text>
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.cardLarge,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    ...floatingShadow,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.liveGreen },
  title: { fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', fontSize: 12 },
  remaining: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 13 },
  autoPill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill },
  autoOn: { backgroundColor: colors.primary },
  autoOff: { backgroundColor: 'rgba(255,255,255,0.08)' },
  autoText: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyExtrabold, fontSize: 10, letterSpacing: 0.5 },
  autoTextOff: { color: 'rgba(255,255,255,0.6)' },
});
