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
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, typography } from '../../constants/theme';

const ICON = require('../../../assets/splash-icon.png');
const DURATION_MS = 600;

// 2026-07-26 재작성 — 앱 실행 "번쩍임" 해결. 네이티브 런치스크린(expo-splash: 박스없는 splash-icon.png,
// 화면중앙 120px, 배경 #060709)과 "완전히 동일한 첫 프레임"을 갖도록 이 스플래시도 로고를 화면 중앙에
// 120px·박스 없이 고정 표시한다. 그러면 [아이콘 확대(iOS 시스템)] → [런치 로고] → [이 스플래시 로고]가
// 같은 위치·크기라 끊김 없이 하나로 이어진다(예전엔 로고가 박스+위쪽+opacity0→1이라 점프·번쩍였음).
// 브랜딩(PACE 텍스트/로딩바)만 로고 아래에 절대배치로 페이드인 — 로고는 미동 없음.
export function AnimatedSplash({ onComplete }: { onComplete: () => void }) {
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);
  const barX = useSharedValue(-1);

  useEffect(() => {
    textOpacity.value = withDelay(150, withTiming(1, { duration: 220 }));
    textY.value = withDelay(150, withTiming(0, { duration: 220 }));
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 260, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, onComplete, textOpacity, textY]);

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${barX.value * 100}%` }],
  }));

  return (
    <Animated.View exiting={FadeOut.duration(400)} style={styles.container}>
      {/* 로고: 런치스크린과 동일 — 화면 중앙, 120px, 박스/애니메이션 없음(미동 없이 이어짐). */}
      <Image source={ICON} style={styles.icon} />

      {/* 브랜딩 텍스트: 로고 아래 절대배치로 페이드인(로고 위치는 안 건드림). */}
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
    justifyContent: 'center', // 로고를 화면 정중앙에(런치스크린과 동일)
  },
  icon: { width: 120, height: 120 },
  // 텍스트는 화면 중앙 로고 아래에 절대배치 — 로고를 위로 밀지 않게.
  textBlock: { position: 'absolute', top: '50%', marginTop: 84, alignItems: 'center' },
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
