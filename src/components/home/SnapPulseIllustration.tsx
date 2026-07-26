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
  // 2026-07-27 사용자 지적("손짓/블루투스 아이콘 더 키우라니까") — 40x36/34x20 컨테이너가 너무
  // 작아 잘 안 보였다는 재지적, 세 일러스트(스냅/손짓/리모컨) 전부 한 단계 키움.
  wrap: { width: 56, height: 50, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 50, height: 50 },
  flash: { position: 'absolute' },
});
