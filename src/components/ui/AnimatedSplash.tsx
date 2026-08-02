import { useCallback, useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, typography } from '../../constants/theme';

// 2026-08-02 사장님 지시 최종 — 아주 예전 "원 + 아이콘 + 사선 빛" 복원. 불투명 사각 아이콘은 원을
// 가려서 "원 안의 아이콘"이 안 됐다 → 투명 매듭(Phone11_bgt)을 써야 보라 원이 매듭 사이로 비쳐 원
// 안에서 빛난다. 그 원 안을 대각선(45°) 바이올렛 빛줄기가 훑고 지나간다(흰색 아님 = 안 촌스러움).
const ICON = require('../../../assets/Phone11_bgt.png');
const DURATION_MS = 1400;
const ICON_SIZE = 156;   // 투명 매듭
const CIRCLE_SIZE = 210; // 매듭을 감싸는 원(빛줄기가 이 원 안에서 사선으로 훑는다)
const GLOW_SIZE = 320;   // 원 밖으로 번지는 보라 후광

export function AnimatedSplash({ onComplete, onLayoutReady }: { onComplete: () => void; onLayoutReady?: () => void }) {
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);
  const barX = useSharedValue(-1);
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(0.9);
  const glossX = useSharedValue(-1); // 대각선 빛줄기 위치

  useEffect(() => {
    textOpacity.value = withDelay(240, withTiming(1, { duration: 240 }));
    textY.value = withDelay(240, withTiming(0, { duration: 240 }));
    // 보라 글로우 원: 뒤에서 부드럽게 차오름(블룸).
    glowOpacity.value = withDelay(40, withTiming(1, { duration: 460, easing: Easing.out(Easing.ease) }));
    glowScale.value = withDelay(40, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
    // 대각선 빛줄기: 왼쪽 위 → 오른쪽 아래로 훑고, 잠깐 쉬었다 반복.
    glossX.value = withDelay(
      140,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 950, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 650 }),
          withTiming(-1, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, glossX, glowOpacity, glowScale, onComplete, textOpacity, textY]);

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));
  const glossStyle = useAnimatedStyle(() => ({
    // 45° 대각선 빛줄기가 좌우로 이동하며 원 안을 훑는다.
    transform: [{ translateX: glossX.value * (CIRCLE_SIZE * 0.62) }, { rotate: '45deg' }],
  }));
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${barX.value * 100}%` }],
  }));

  // 레이아웃/이미지로드 둘 다 끝났을 때만 네이티브 런치스크린을 내린다(원-아이콘 갭 방지). ref로 1회만.
  const layoutDoneRef = useRef(false);
  const iconDoneRef = useRef(false);
  const handoffDoneRef = useRef(false);
  const tryHandoff = useCallback(() => {
    if (handoffDoneRef.current) return;
    if (!layoutDoneRef.current || !iconDoneRef.current) return;
    handoffDoneRef.current = true;
    onLayoutReady?.();
  }, [onLayoutReady]);
  const markLayoutReady = useCallback(() => { layoutDoneRef.current = true; tryHandoff(); }, [tryHandoff]);
  const markIconReady = useCallback(() => { iconDoneRef.current = true; tryHandoff(); }, [tryHandoff]);
  useEffect(() => {
    const t = setTimeout(() => { iconDoneRef.current = true; layoutDoneRef.current = true; tryHandoff(); }, 1500);
    return () => clearTimeout(t);
  }, [tryHandoff]);

  return (
    <Animated.View exiting={FadeOut.duration(400)} style={styles.container} onLayout={markLayoutReady}>
      {/* ① 보라 글로우 원 — 아이콘 뒤 후광(SVG radial, 매끈한 빛). */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, glowStyle]} pointerEvents="none">
        <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
          <Defs>
            <RadialGradient id="paceGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={colors.primary} stopOpacity={0.55} />
              <Stop offset="42%" stopColor={colors.primary} stopOpacity={0.28} />
              <Stop offset="72%" stopColor={colors.primary} stopOpacity={0.08} />
              <Stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={GLOW_SIZE / 2} cy={GLOW_SIZE / 2} r={GLOW_SIZE / 2} fill="url(#paceGlow)" />
        </Svg>
      </Animated.View>

      {/* ② 원 안의 투명 매듭 + ③ 원 안을 훑는 대각선 바이올렛 빛줄기. circleClip이 정확히 원이라
          빛줄기가 원 곡선을 따라 잘려 "빛나는 원 안을 사선 빛이 지나가는" 느낌. 매듭이 투명이라 그 빛이
          매듭 사이로 비친다. */}
      <View style={styles.circleClip}>
        <Image source={ICON} style={styles.icon} onLoad={markIconReady} />
        <Animated.View style={[styles.gloss, glossStyle]} pointerEvents="none">
          <LinearGradient
            colors={['transparent', 'rgba(198,174,255,0.42)', 'rgba(198,174,255,0.08)', 'transparent']}
            locations={[0, 0.5, 0.62, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>

      <Animated.View style={[styles.textBlock, textStyle]}>
        <Text style={styles.title}>PACE</Text>
        <Text style={styles.subtitle}>Dopamine Loop Guard</Text>
      </Animated.View>

      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, barStyle]}>
          <LinearGradient
            colors={['transparent', colors.primary, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 110,
    backgroundColor: '#060709',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  // 빛나는 원 — 매듭을 감싸는 정확한 원. 빛줄기를 이 원 안에 가둬 원 곡선을 따라 잘리게 한다.
  circleClip: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: ICON_SIZE, height: ICON_SIZE },
  // 대각선 빛줄기 — 45° 회전해도 원 전체를 훑도록 위아래로 넉넉히 뺀다.
  gloss: { position: 'absolute', top: -90, bottom: -90, width: 92 },
  textBlock: { position: 'absolute', top: '50%', marginTop: 128, alignItems: 'center' },
  title: {
    fontSize: 30,
    fontFamily: typography.bodyFontFamilyExtrabold,
    color: colors.textPrimary,
    letterSpacing: 10,
    textAlign: 'center',
    marginLeft: 10,
  },
  subtitle: {
    fontSize: 10,
    fontFamily: typography.bodyFontFamilyExtrabold,
    color: '#818CF8',
    letterSpacing: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginTop: 8,
    opacity: 0.6,
  },
  barTrack: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    width: 160,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  barFill: { width: '50%', height: '100%' },
});
