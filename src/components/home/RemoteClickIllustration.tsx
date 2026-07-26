import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '../../constants/theme';

const CYCLE_MS = 2200;
const PRESS_MS = 160;

// GestureFlickIllustration/SnapPulseIllustration과 같은 시리즈 — 블루투스 리모컨 볼륨 버튼을
// 누르는 동작을 아이콘이 눌렸다 올라오는 프레스 애니메이션으로 표현.
export function RemoteClickIllustration() {
  const pressY = useSharedValue(0);

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    const press = () => {
      pressY.value = withTiming(2, { duration: PRESS_MS, easing: Easing.out(Easing.quad) }, (finished) => {
        'worklet';
        if (finished) {
          pressY.value = withTiming(0, { duration: PRESS_MS, easing: Easing.in(Easing.quad) });
        }
      });
    };
    press();
    id = setInterval(press, CYCLE_MS);
    return () => clearInterval(id);
  }, [pressY]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pressY.value }],
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={iconStyle}>
        <Feather name="bluetooth" size={16} color={colors.textSecondary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 34, height: 20, alignItems: 'center', justifyContent: 'center' },
});
