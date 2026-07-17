import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassSurface } from '../ui/GlassSurface';
import { colors, spacing, typography } from '../../constants/theme';
import { formatRemaining } from './shared/formatRemaining';
import { OVERLAY_BAR_HEIGHT, type OverlayBarProps } from './shared/OverlayBar.types';
import { useTranslation } from '../../services/i18n';

// iOS = 사각 "프레임" 배너. Android의 떠 있는 알약과 의도적으로 다른 형태를 쓴다 — iOS는 다른 앱
// 위에 진짜 시스템 오버레이를 띄울 수 없고(실기기에서는 ActivityKit Live Activity/Dynamic Island가
// 잠금화면·아일랜드에 대신 표시), 이 컴포넌트는 Pace 앱이 포그라운드일 때만 보이는 인앱 폴백이다.
// 형태(여백 없는 사각 프레임 vs 여백 있는 알약)로 "이건 시스템 오버레이가 아니라 앱 내부 프레임"이라는
// 차이를 시각적으로도 드러낸다. Auto Next 토글은 없음(supportsAutoNext=false, capability 플래그).
//
// 2026-07-18: 실제 글래스모피즘 적용(GlassSurface) — iOS는 BlurView 진짜 블러(systemMaterialDark),
// 임의의 영상 콘텐츠 위에 뜨는 프레임이라 실제 블러가 있어야 그 아래 콘텐츠가 반투명하게 비쳐 보이는
// "진짜 유리" 느낌이 난다(정적 rgba 반투명은 그냥 어두운 판일 뿐 유리처럼 보이지 않음).
export function OverlayBar({ remainingMinutes, onToggleExpanded }: OverlayBarProps) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onToggleExpanded} accessibilityRole="button" accessibilityLabel="Pace status" style={styles.frameWrap}>
      <GlassSurface intensity={50} tint="dark" fallbackColor="rgba(9,9,11,0.9)" style={styles.frame}>
        <View style={styles.accent} />
        <View style={styles.content}>
          <View style={styles.left}>
            <Text style={styles.title}>Pace</Text>
            <Text style={styles.remaining}>⏱ {formatRemaining(remainingMinutes)}</Text>
          </View>
          <Text style={styles.hint}>{t('overlay.tapForDetails')}</Text>
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frameWrap: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: 'hidden' },
  frame: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
  title: { fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', fontSize: 12 },
  remaining: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 13 },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: typography.bodyFontFamilySemibold },
});
