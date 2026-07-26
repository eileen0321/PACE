import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '../../constants/theme';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const ICON = require('../../../assets/finger-snap-icon.png');

const CYCLE_MS = 2200;
const SNAP_IN_MS = 90;
const SNAP_OUT_MS = 350;

// 2026-07-26 — 사용자가 실제 배경 제거된 스냅 손 아이콘(assets/finger-snap-icon.png)을 제공해서
// 손그림 SVG 대신 이걸로 교체. 원본은 검은 선(투명 배경)이라 그대로 쓰면 어두운 카드 배경에
// 묻히므로 tintColor로 앱 아이콘 톤(textSecondary)을 입힌다. 스냅 순간엔 같은 이미지를 브랜드
// 컬러(primary)로 겹쳐 그려 opacity를 반짝였다 지운다 — 이미지에 스파크가 이미 그려져 있어서
// 전체가 같이 반짝이는 게 "지금 스냅했다"는 순간을 표현.
export function SnapPulseIllustration() {
  const flashOpacity = useSharedValue(0);

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    const snap = () => {
      flashOpacity.value = withTiming(1, { duration: SNAP_IN_MS }, (finished) => {
        'worklet';
        if (finished) {
          flashOpacity.value = withTiming(0, { duration: SNAP_OUT_MS });
        }
      });
    };
    snap();
    id = setInterval(snap, CYCLE_MS);
    return () => clearInterval(id);
  }, [flashOpacity]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  return (
    <View style={styles.wrap}>
      <Image source={ICON} style={[styles.icon, { tintColor: colors.textSecondary }]} resizeMode="contain" />
      <AnimatedImage
        source={ICON}
        style={[styles.icon, styles.flash, { tintColor: colors.primary }, flashStyle]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 36, height: 36 },
  flash: { position: 'absolute' },
});
