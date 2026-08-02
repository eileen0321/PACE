import { useCallback, useEffect, useRef } from 'react';
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

// 2026-08-02 사장님 지시(레퍼런스 이미지 첨부) — 스플래시를 "유광 앱 아이콘"으로. 예전엔 투명 로고 +
// 글로우 원/흰색 밴드로 만들었는데 (1)앞에 뜨는 작은 앱 아이콘과 너무 달랐고 (2)흰색 번짐이 촌스러웠다.
// 해결: 앱 아이콘(ios-icon.png — 유광 다크 패널에 사선 글로시 빛이 이미 들어있음)을 그대로 스플래시
// 중앙에 둥근 사각(스퀘어클) 패널로 키워 보여준다 → 앱 아이콘 확대와 완벽히 이어지고(차이 없음),
// 유광 사선 빛이 그대로 살아 고급스럽다. 그 위로 은은한 사선 빛줄기가 한 번 훑고 지나가(유광 반사가
// 움직이는 느낌) "선명한 빛효과"를 더한다 — 흰 밴드가 아니라 유광 패널 위 부드러운 반사라 안 촌스럽다.
const ICON = require('../../../assets/ios-icon.png');
const DURATION_MS = 1400;
const ICON_SIZE = 168;
const ICON_RADIUS = Math.round(ICON_SIZE * 0.2237); // iOS 스퀘어클 비율

// 상용앱 규칙: 네이티브 런치스크린과 애니메이션 스플래시의 "첫 프레임"이 시각적으로 동일해야 한다(번쩍 방지).
// 로고(앱 아이콘)는 처음부터 고정으로 떠 있고, 빛줄기/텍스트/로딩바만 그 위에 얹어 페이드인한다.
export function AnimatedSplash({ onComplete, onLayoutReady }: { onComplete: () => void; onLayoutReady?: () => void }) {
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);
  const barX = useSharedValue(-1);
  // 사선 유광 반사 — 아이콘 패널 위를 비스듬히(18°) 훑고 지나가는 부드러운 빛줄기.
  const glossX = useSharedValue(-1);

  useEffect(() => {
    textOpacity.value = withDelay(220, withTiming(1, { duration: 240 }));
    textY.value = withDelay(220, withTiming(0, { duration: 240 }));
    // 유광 반사: 아이콘 뜬 직후 한 번 천천히(1100ms) 훑고, 잠시 쉬었다 반복(은은하게).
    glossX.value = withDelay(
      160,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 700 }), // 잠깐 정지
          withTiming(-1, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    // 하단 로딩바 빛 스윕.
    barX.value = withRepeat(withSequence(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), withTiming(-1, { duration: 0 })), -1, false);

    const timer = setTimeout(onComplete, DURATION_MS);
    return () => clearTimeout(timer);
  }, [barX, glossX, onComplete, textOpacity, textY]);

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const glossStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: glossX.value * (ICON_SIZE * 0.95) }, { rotate: '18deg' }],
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
      {/* 유광 앱 아이콘 패널(둥근 사각) + 그 위를 훑는 사선 빛줄기. iconClip이 둥근 사각이라 빛줄기가
          아이콘 모서리(라운드)를 따라 잘려 "유광 패널 위 반사"로 자연스럽게 읽힌다. */}
      <View style={styles.iconClip}>
        <Image source={ICON} style={styles.icon} onLoad={markIconReady} />
        <Animated.View style={[styles.gloss, glossStyle]} pointerEvents="none">
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.03)', 'transparent']}
            locations={[0, 0.45, 0.6, 1]}
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
  // 유광 앱 아이콘 패널 — 둥근 사각(스퀘어클), 빛줄기를 이 안에 가둔다. 미세한 테두리로 패널감.
  iconClip: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  icon: { width: ICON_SIZE, height: ICON_SIZE },
  // 사선 빛줄기 밴드 — 위아래로 넉넉히 빼서(top/bottom -40) 18° 회전해도 패널 전체를 훑는다.
  gloss: { position: 'absolute', top: -40, bottom: -40, width: 72 },
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
