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
// 🔴 2026-09-04 사장님 지시("손짓 가이드도 왼쪽에서 오른쪽으로 손 크기 동일하게 바꿔야지") —
//   아래 2026-07-26 주석은 "감지기가 손이 카메라 쪽으로 다가와 화면을 가리는 정도로 트리거된다"를
//   근거로 세로(아래→위, 다가옴) 애니메이션을 정당화했다. **그 전제가 오늘 바뀌었다.**
//   다가옴 축(grew/grewFast)은 오탐의 원인이라 발화에서 뺐고, 이제 인식되는 동작은 카메라 앞을
//   **가로로 스쳐 지나가는 것**뿐이다(PaceHandWaveDetector 의 2026-09-04 주석 참고).
//   가이드가 실제로 안 먹는 동작을 가르치면 사용자는 "손짓이 안 된다"고 느낀다 — 방향을 맞춘다.
//   손 크기는 일정해야 하므로(다가오면 커진다) scale 애니메이션도 넣지 않는다.
const SWEEP_X = 16; // 좌 → 우 가로 이동 거리

// 2026-07-26 사용자 정정 1차 — "가로젓는 게 아니잖아, 훠이는" — 손이 폰 옆을 스쳐 지나가는 좌우
// 이동은 틀렸다. 2차 정정 — "아래는 주먹에서 시작해서 폰 위로 가면 손 펴있는 모습이라고, 왜
// 반대로 해" — 방향이 거꾸로였다: 손이 위(폰 앞)에서 시작해 아래로 내려오는 게 아니라, **아래에서
// 주먹으로 시작해 위로 올라오면서 폰 위치에 도달할 때 편 손이 돼야 한다**. 실제 감지기
// (PaceHandWaveDetector)가 "손이 카메라 쪽으로 다가와 화면을 가리는 정도"로 트리거되는 것과도
// 이 방향(아래→위로 다가옴)이 더 맞는다.
export function GestureFlickIllustration() {
  const progress = useSharedValue(0); // 0 = 왼쪽 바깥, 1 = 오른쪽 바깥(폰 앞을 가로질러 감)

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    const sweepAcross = () => {
      progress.value = withSequence(
        withTiming(1, { duration: SWAP_MS, easing: Easing.out(Easing.cubic) }),
        withDelay(HOLD_MS, withTiming(0, { duration: SWAP_MS, easing: Easing.in(Easing.cubic) })),
      );
    };
    sweepAcross();
    id = setInterval(sweepAcross, CYCLE_MS);
    return () => clearInterval(id);
  }, [progress]);

  // 왼쪽 바깥(-SWEEP_X)에서 오른쪽 바깥(+SWEEP_X)으로 가로질러 간다. 크기는 건드리지 않는다 —
  // 커지는 순간이 곧 "다가옴"이라 지금 감지기가 거부하는 동작이다.
  const handStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.12, 0.88, 1], [0, 1, 1, 0]),
    transform: [{ translateX: -SWEEP_X + progress.value * SWEEP_X * 2 }],
  }));
  // 사용자 지적("주먹이 더 작아야, 훠이 하고 커지며 펴지는 한 동작") — 주먹은 항상 편 손보다
  // 작게 그려서, 크로스페이드되는 순간 "작은 주먹이 확 커지며 펴진다"는 인상을 준다.
  // 주먹→편 손 크로스페이드는 "훠이 하고 펴진다"(다가옴)를 표현하던 것이라 뺀다. 스침은 편 손이
  // 같은 크기로 지나가는 한 동작이다. 주먹 아이콘은 항상 숨긴다(에셋/레이아웃은 그대로 둔다).
  const fistStyle = useAnimatedStyle(() => ({ opacity: 0 }));
  const openStyle = useAnimatedStyle(() => ({ opacity: 1 }));

  return (
    <View style={styles.wrap}>
      {/* 맨 뒤: 폰 실루엣 — 고정, 손이 그 앞을 가로질러 지나간다 */}
      <Svg width={18} height={30} viewBox="0 0 13 22" style={styles.phone}>
        <Rect x={1} y={1} width={11} height={20} rx={3} fill={colors.card} stroke={colors.textTertiary} strokeWidth={1.3} />
      </Svg>
      {/* 맨 앞: 편 손이 같은 크기로 왼쪽 → 오른쪽으로 폰 앞을 스쳐 지나감 */}
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
  // 2026-07-27 사용자 지적("아이콘 더 키우라니까") — SnapPulse/RemoteClick과 동일하게 확대.
  wrap: { width: 56, height: 50, alignItems: 'center', justifyContent: 'center' },
  phone: { position: 'absolute' },
  handHover: { position: 'absolute', top: 18 },
  hand: { width: 22, height: 26 },
  handOverlay: { position: 'absolute' },
});
