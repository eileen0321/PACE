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
const DESCEND = 7;

// 2026-07-26 사용자 정정 — "가로젓는 게 아니잖아, 훠이는" — 손이 폰 옆을 스쳐 지나가는 좌우 이동은
// 틀렸다. 실제 감지기(PaceHandWaveDetector)는 손이 카메라 쪽으로 다가와 화면을 가리는 정도
// (growthRatio)로 트리거되므로, 손은 폰 위에 고정된 채 주먹에서 편 손으로 열리면서 살짝 아래로
// 다가와(내려와) 폰 위를 덮는 동작이어야 한다 — 좌우 이동 전부 제거, 위→아래로만 움직인다.
export function GestureFlickIllustration() {
  const progress = useSharedValue(0); // 0 = 주먹(폰 위, 살짝 뜬 상태), 1 = 편 손(폰 위로 내려와 덮음)

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    const openOverPhone = () => {
      progress.value = withSequence(
        withTiming(1, { duration: SWAP_MS, easing: Easing.out(Easing.cubic) }),
        withDelay(HOLD_MS, withTiming(0, { duration: SWAP_MS, easing: Easing.in(Easing.cubic) })),
      );
    };
    openOverPhone();
    id = setInterval(openOverPhone, CYCLE_MS);
    return () => clearInterval(id);
  }, [progress]);

  const handStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * DESCEND }],
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
      {/* 맨 뒤: 폰 실루엣 — 고정, 손이 그 위로 내려와 덮는다 */}
      <Svg width={13} height={22} viewBox="0 0 13 22" style={styles.phone}>
        <Rect x={1} y={1} width={11} height={20} rx={3} fill={colors.card} stroke={colors.textTertiary} strokeWidth={1.3} />
      </Svg>
      {/* 맨 앞: 폰 위에 뜬 주먹 → 편 손으로 열리며 살짝 내려와 폰 위를 덮음(좌우 이동 없음) */}
      <Animated.View style={[styles.handHover, handStyle]}>
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
  handHover: { position: 'absolute', top: -3 },
  hand: { width: 16, height: 19 },
  handOverlay: { position: 'absolute' },
});
