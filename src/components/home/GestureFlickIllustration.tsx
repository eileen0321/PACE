import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../constants/theme';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const FIST_ICON = require('../../../assets/hand-fist-icon.png');
const OPEN_ICON = require('../../../assets/hand-open-icon.png');

const CYCLE_MS = 2600;
const SWAP_MS = 420;
const HOLD_MS = 550;
const TRAVEL = 11;

// 2026-07-26 — 사용자 최종 스펙: "폰 가운데, 왼쪽 주먹 → 폰 오른쪽 편 손, 그래야 카메라를 스쳐서
// 가릴 거 아냐" — 손이 고정된 두 자리에서 그냥 크로스페이드하는 게 아니라, 실제로 왼쪽에서
// 오른쪽으로 이동하면서 폰(카메라) 앞을 스쳐 지나가야 한다는 지적. 폰을 먼저 그려 뒤에 깔고
// (z-index 낮음), 손을 그 위에 그려서(z-index 높음) 지나가는 동안 폰을 잠깐 가리게 한다 — 실제
// 감지기(PaceHandWaveDetector)가 "손이 카메라에 가까워져 화면을 가리는 정도"로 트리거되는 것과도
// 그림이 맞아떨어진다.
export function GestureFlickIllustration() {
  const progress = useSharedValue(0); // 0 = 주먹(왼쪽), 1 = 편 손(오른쪽)

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    const sweep = () => {
      progress.value = withSequence(
        withTiming(1, { duration: SWAP_MS, easing: Easing.inOut(Easing.cubic) }),
        withDelay(HOLD_MS, withTiming(0, { duration: SWAP_MS, easing: Easing.inOut(Easing.cubic) })),
      );
    };
    sweep();
    id = setInterval(sweep, CYCLE_MS);
    return () => clearInterval(id);
  }, [progress]);

  const handStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
  }));
  // 사용자 지적("주먹이 더 작아야, 훠이 하고 커지며 펴지는 한 동작") — 주먹은 항상 편 손보다
  // 작게 그려서, 크로스페이드되는 순간 "작은 주먹이 확 커지며 펴진다"는 인상을 준다.
  const fistStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4, 0.6, 1], [1, 1, 0, 0]),
    transform: [{ scale: 0.7 }],
  }));
  const openStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4, 0.6, 1], [0, 0, 1, 1]),
  }));

  return (
    <View style={styles.wrap}>
      {/* 맨 뒤: 폰 실루엣 — 고정, 손이 그 앞을 지나간다 */}
      <Svg width={13} height={22} viewBox="0 0 13 22" style={styles.phone}>
        <Rect x={1} y={1} width={11} height={20} rx={3} fill={colors.card} stroke={colors.textTertiary} strokeWidth={1.3} />
      </Svg>
      {/* 맨 앞: 왼쪽 주먹 → (폰 앞을 스쳐) → 오른쪽 편 손으로 이동하며 크로스페이드 */}
      <Animated.View style={[styles.handTravel, handStyle]}>
        <AnimatedImage
          source={FIST_ICON}
          style={[styles.hand, { tintColor: colors.textSecondary }, fistStyle]}
          resizeMode="contain"
        />
        <AnimatedImage
          source={OPEN_ICON}
          style={[styles.hand, styles.handOverlay, { tintColor: colors.textSecondary }, openStyle]}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  phone: { position: 'absolute' },
  handTravel: { position: 'absolute', left: 5 },
  hand: { width: 16, height: 19 },
  handOverlay: { position: 'absolute' },
});
