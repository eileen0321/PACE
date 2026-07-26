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
const RISE = 10;

// 2026-07-26 사용자 정정 1차 — "가로젓는 게 아니잖아, 훠이는" — 손이 폰 옆을 스쳐 지나가는 좌우
// 이동은 틀렸다. 2차 정정 — "아래는 주먹에서 시작해서 폰 위로 가면 손 펴있는 모습이라고, 왜
// 반대로 해" — 방향이 거꾸로였다: 손이 위(폰 앞)에서 시작해 아래로 내려오는 게 아니라, **아래에서
// 주먹으로 시작해 위로 올라오면서 폰 위치에 도달할 때 편 손이 돼야 한다**. 실제 감지기
// (PaceHandWaveDetector)가 "손이 카메라 쪽으로 다가와 화면을 가리는 정도"로 트리거되는 것과도
// 이 방향(아래→위로 다가옴)이 더 맞는다.
export function GestureFlickIllustration() {
  const progress = useSharedValue(0); // 0 = 주먹(아래), 1 = 편 손(위로 올라와 폰을 덮음)

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
    transform: [{ translateY: progress.value * -RISE }],
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
      {/* 맨 앞: 아래쪽 주먹 → 편 손으로 열리며 위로 올라와 폰 위를 덮음(좌우 이동 없음) */}
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
  handHover: { position: 'absolute', top: 13 },
  hand: { width: 16, height: 19 },
  handOverlay: { position: 'absolute' },
});
