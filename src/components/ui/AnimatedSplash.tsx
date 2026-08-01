import { useEffect } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
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

// 2026-08-01 사장님 지적("빛바래 보이잖아") — splash-icon.png가 앱 아이콘보다 어두운(칙칙한) 렌더라
// iOS 스플래시가 빛바래 보였다. iOS만 vibrant 글로우 버전(ios-splash-icon.png = 앱 아이콘과 동일 밝기)으로
// 교체. Android는 공용 컴포넌트 회귀 방지 위해 기존(splash-icon.png) 그대로 유지(Android 도메인 불변).
const ICON = Platform.OS === 'ios'
  ? require('../../../assets/ios-splash-icon.png')
  : require('../../../assets/splash-icon.png');
const DURATION_MS = 600;

// 2026-07-26 재작성(웹리서치 반영 — Apple HIG + Uber/Swiggy 방식): 앱 실행 "아이콘 번쩍" 해결.
// 상용앱 규칙: 네이티브 런치스크린과 애니메이션 스플래시의 "첫 프레임"이 시각적으로 동일해야 한다.
// 로고를 opacity 0→1/scale로 "등장"시키면 그 순간이 번쩍인다. → 로고는 런치스크린과 똑같이(화면 중앙,
// 120px, 박스 없음) 처음부터 떠 있고, 나머지 브랜딩 효과(글로우/시머/PACE 텍스트/로딩바)만 그 위에
// 얹어 페이드인한다. 이러면 [iOS 아이콘 확대]→[런치 로고]→[스플래시 로고]가 미동 없이 이어진다.
export function AnimatedSplash({ onComplete, onLayoutReady }: { onComplete: () => void; onLayoutReady?: () => void }) {
  const glowOpacity = useSharedValue(0);
  const shimmerX = useSharedValue(-1);
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);
  const barX = useSharedValue(-1);

  useEffect(() => {
    // 로고는 애니메이션 없음(런치스크린과 동일 고정). 효과만 등장.
    glowOpacity.value = withDelay(60, withTiming(1, { duration: 280 }));
    shimmerX.value = withRepeat(withTiming(1, { duration: 550, easing: Easing.linear }), -1, false);
    textOpacity.value = withDelay(150, withTiming(1, { duration: 220 }));
    textY.value = withDelay(150, withTiming(0, { duration: 220 }));
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 260, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, glowOpacity, onComplete, shimmerX, textOpacity, textY]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));
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
    <Animated.View
      exiting={FadeOut.duration(400)}
      style={styles.container}
      // ⭐ 네이티브 런치스크린은 "이 JS 스플래시가 실제로 그려진 뒤에" 숨겨야 갭(번쩍/끊김)이 없다.
      // (reactnativeschool: onLayout 시점 = 첫 프레임 페인트 완료. 여기서 SplashScreen.hideAsync 호출.)
      onLayout={onLayoutReady}
    >
      {/* 로고: 런치스크린과 동일 — 화면 중앙, 120px, 박스/애니메이션 없음(미동 없이 이어짐). */}
      <View style={styles.iconArea}>
        {/* 글로우는 로고 뒤에서 은은히 페이드인(첫 프레임엔 없음 → 런치와 일치). */}
        <Animated.View style={[styles.glow, glowStyle]} />
        <View style={styles.iconClip}>
          <Image source={ICON} style={styles.icon} />
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
        </View>
      </View>

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
  iconArea: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: `${colors.primary}22`,
  },
  // 로고(120px)와 정확히 같은 크기의 클립 컨테이너 — 시머만 로고 영역에 가둔다(박스/테두리 없음 = 런치와 동일).
  // 2026-08-01 사장님 지시("아이콘 너무 꽉차보임 — 패딩 좀") — 로고를 120→88로 줄여 사방 여백을 준다.
  // 네이티브 런치스크린도 app.json imageWidth를 88로 맞춰야 [런치→JS 스플래시]가 미동 없이 이어진다.
  iconClip: { width: 88, height: 88, overflow: 'hidden' },
  icon: { width: 88, height: 88 },
  shimmer: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 40,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
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
