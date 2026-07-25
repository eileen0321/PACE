import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { radius, spacing, typography } from '../../constants/theme';

// 피드 시청 중 Focus Session 남은시간을 "가끔" 살짝 보여주는 글래스모피즘 필(사용자 지시 2026-07-25).
// 계속 떠서 영상을 가리지 않게 — 세션 시작 시 1회 + 이후 주기적으로 잠깐 페이드인했다 사라진다.
// 상시 카운트다운은 다이나믹 아일랜드 Live Activity가 담당하고, 이건 인앱 보조 힌트.
const SHOW_MS = 3800; // 한 번 뜰 때 보이는 시간
const INTERVAL_MS = 3 * 60 * 1000; // 3분마다 잠깐

export function SessionTimePill({ endsAt }: { endsAt: number | null }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-6);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (endsAt == null) {
      opacity.value = withTiming(0, { duration: 300 });
      return;
    }
    const flash = () => {
      const min = Math.max(0, Math.ceil((endsAt - Date.now()) / 60000));
      setLabel(`${min}m`);
      opacity.value = withSequence(withTiming(1, { duration: 450 }), withDelay(SHOW_MS, withTiming(0, { duration: 600 })));
      translateY.value = withSequence(withTiming(0, { duration: 450 }), withDelay(SHOW_MS, withTiming(-6, { duration: 600 })));
    };
    flash(); // 세션 시작 시 1회
    const id = setInterval(flash, INTERVAL_MS);
    return () => clearInterval(id);
  }, [endsAt, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));

  if (endsAt == null) return null;

  return (
    <Animated.View style={[styles.wrap, animStyle]} pointerEvents="none">
      <BlurView intensity={24} tint="dark" style={styles.pill}>
        <Feather name="watch" size={12} color="rgba(255,255,255,0.9)" />
        <Text style={styles.text}>{label}</Text>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  text: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontFamily: typography.monoFontFamilyBold },
});
