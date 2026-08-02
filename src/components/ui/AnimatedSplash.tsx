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

// 2026-08-02 플랫폼 분기(co-session a7cdfda가 공유 ICON을 Phone11_bgt로 바꾼 것을 iOS만 되돌림):
//   iOS   = Phone11.png(유광) — 앱 아이콘(icon-phone11)과 동일 이미지라 [아이콘 확대]→[스플래시]가
//           매끄럽게 이어진다. 사장님이 긴 과정 끝에 확정한 iOS 선택("빛바랜거 쓰지 말랫지"→유광).
//   Android= Phone11_bgt.png(투명 매듭) — 불투명 유광 패널이 안드 스플래시에선 사각 판처럼 떠 보여
//           글로우 원이 안 읽힌다. co-session이 투명본으로 바꿔 원 안에 매듭이 자연스럽게 들어간다.
// Metro는 두 require를 모두 정적 분석해 번들에 포함하고 런타임이 플랫폼별로 고른다.
const ICON = Platform.OS === 'ios'
  ? require('../../../assets/Phone11.png')
  : require('../../../assets/Phone11_bgt.png');
// 2026-08-01 사장님 지시 — 로고 위 "빛 지나가는(shine sweep)" 효과가 600ms + 12% 흰색이라 실질적으로
// 안 보였다. 스플래시를 950ms로 살짝 늘려 스윕 1회가 온전히 보이게 하고, 빛 바를 그라데이션+밝기 상향.
const DURATION_MS = 950;

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
  // 2026-08-02 사장님 지시("앞에 작은 아이콘 없애") — 네이티브 런치스크린을 아이콘 없이 배경만
  // 나오게 바꿨으므로(app.json splash-blank), 로고는 이 JS 스플래시에서 부드럽게 페이드인한다.
  const iconOpacity = useSharedValue(0);

  useEffect(() => {
    iconOpacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    glowOpacity.value = withDelay(60, withTiming(1, { duration: 280 }));
    shimmerX.value = withDelay(120, withRepeat(withTiming(1, { duration: 700, easing: Easing.linear }), -1, false));
    textOpacity.value = withDelay(150, withTiming(1, { duration: 220 }));
    textY.value = withDelay(150, withTiming(0, { duration: 220 }));
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 260, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, glowOpacity, iconOpacity, onComplete, shimmerX, textOpacity, textY]);

  const iconStyle = useAnimatedStyle(() => ({ opacity: iconOpacity.value }));
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
      {/* 로고 — 네이티브 런치엔 아이콘이 없으므로 여기서 부드럽게 페이드인. 화면 중앙, 120px. */}
      <Animated.View style={[styles.iconArea, iconStyle]}>
        {/* 글로우는 로고 뒤에서 은은히 페이드인. */}
        <Animated.View style={[styles.glow, glowStyle]} />
        <View style={styles.iconClip}>
          <Image source={ICON} style={styles.icon} />
          {/* 로고 위를 대각선으로 지나가는 "빛 스윕" — 가장자리가 투명한 그라데이션이라 은은하게 번쩍인다. */}
          <Animated.View style={[styles.shimmer, shimmerStyle]}>
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.5)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </Animated.View>

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
  // 2026-08-02 사장님 지적("원 안에 아이콘 보이게 하라고") — 글로우 원(220)이 부모 iconArea(120)보다
  // 커서 원의 바깥쪽이 부모 경계에서 잘려 나가고 있었다(안드로이드는 부모 밖 자식을 그리지 않는다).
  // 부모를 원과 같은 220으로만 키운다 — 로고 크기/위치는 아래 iconClip(120)이 잡으므로 그대로다.
  iconArea: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: `${colors.primary}22`,
  },
  // 로고(120px)와 정확히 같은 크기의 클립 컨테이너 — 시머만 로고 영역에 가둔다(박스/테두리 없음 = 런치와 동일).
  iconClip: { width: 120, height: 120, overflow: 'hidden' },
  icon: { width: 120, height: 120 },
  shimmer: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 60,
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
