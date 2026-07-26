import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, typography } from '../../constants/theme';

const ICON = require('../../../assets/splash-icon.png');
const DURATION_MS = 600;

// healthy-shorts-assistant(4) Splash.tsx 이식(사용자 명시적 지시, 2026-07-21) — Framer Motion의
// spring/shimmer/tracking-in 애니메이션을 react-native-reanimated로 재구현. expo-splash-screen의
// 정적 네이티브 스플래시(assets/splash-icon.png, app.json 설정)가 폰트 로딩까지만 담당하고, 그
// 직후 이 컴포넌트가 이어받아 애니메이션 브랜딩을 보여준 뒤 스스로 사라진다(_layout.tsx에서 최상단
// Stack 위에 절대배치로 마운트).
export function AnimatedSplash({ onComplete }: { onComplete: () => void }) {
  // 로고는 처음부터 딱 떠 있게(opacity 1, scale 1) — 예전엔 0→1/0.8→1로 떠올라 "아이콘이 번쩍"처럼
  // 보였다(사장님 지적). 애니메이션은 텍스트/로딩바만.
  const iconScale = useSharedValue(1);
  const iconOpacity = useSharedValue(1);
  const shimmerX = useSharedValue(-1);
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);
  const barX = useSharedValue(-1);

  useEffect(() => {
    // 로고 등장 애니메이션 제거(번쩍임 원인) — 처음부터 떠 있음. 시머만 유지.
    shimmerX.value = withRepeat(withTiming(1, { duration: 550, easing: Easing.linear }), -1, false);
    textOpacity.value = withDelay(150, withTiming(1, { duration: 220 }));
    textY.value = withDelay(150, withTiming(0, { duration: 220 }));
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 260, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, iconOpacity, iconScale, onComplete, shimmerX, textOpacity, textY]);

  const iconStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ scale: iconScale.value }],
  }));
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value * 130 }, { rotate: '20deg' }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${barX.value * 100}%` }],
  }));

  return (
    <Animated.View exiting={FadeOut.duration(400)} style={styles.container}>
      <View style={styles.brandBlock}>
        {/* 2026-07-22 수정: 원본 의도는 "원 안 중앙에 아이콘". 기존엔 glow가 top:38% 절대위치로 화면
            위에 떠 있고 아이콘은 flex로 아래에 있어 둘이 따로 놀았다 → glow를 아이콘 뒤 중앙에 겹쳐
            아이콘을 감싸는 오라로 만든다. */}
        <View style={styles.iconArea}>
          <View style={styles.glow} />
          <Animated.View style={[styles.iconWrap, iconStyle]}>
            <Image source={ICON} style={styles.icon} />
            <Animated.View style={[styles.shimmer, shimmerStyle]} />
          </Animated.View>
        </View>

        <Animated.View style={textStyle}>
          <Text style={styles.title}>PACE</Text>
          <Text style={styles.subtitle}>Dopamine Loop Guard</Text>
        </Animated.View>
      </View>

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
    justifyContent: 'center', // 원+아이콘 브랜드 블록을 화면 정중앙에(로딩바는 아래 절대고정)
  },
  // 아이콘(112)을 감싸는 256 원 오라. iconArea가 256 정사각 + 중앙정렬이라 glow는 그 영역을 꽉 채운
  // 원이 되고 iconWrap이 정중앙에 온다 → "원 안 중앙 아이콘".
  iconArea: { width: 256, height: 256, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 256,
    height: 256,
    borderRadius: 128,
    backgroundColor: `${colors.primary}26`,
  },
  brandBlock: { alignItems: 'center', gap: 24 },
  iconWrap: {
    width: 112,
    height: 112,
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  icon: { width: '100%', height: '100%' },
  shimmer: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 40,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
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
    position: 'absolute', // 브랜드 블록 중앙정렬과 분리 — 로딩바는 하단 고정
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
