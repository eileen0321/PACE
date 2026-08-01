import type { PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import { usePathname, useRouter } from 'expo-router';

// 기본(Android/웹) — TabSwipeArea.ios.tsx와 동일한 Fling 로직. iOS/Android 분리는 피드(Shorts) 손가락
// 스와이프에만 해당(iOS는 WebView 재구현이라 자체 터치 훅이 필요하지만, Android는 실제 유튜브 앱을
// AccessibilityService 오버레이로 띄우는 방식이라 네이티브 스와이프가 이미 됨 — 그래서 그쪽만 iOS 전용).
// 탭바 좌우 스와이프는 react-native-gesture-handler Fling + expo-router뿐이라 OS 제약이 없어 Android도 지원.
const TAB_ORDER = ['home', 'focus', 'stats', 'settings'];

export function TabSwipeArea({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const router = useRouter();
  const pathname = usePathname();

  const goRelative = (dir: 1 | -1) => {
    const cur = TAB_ORDER.findIndex((name) => pathname.includes(name));
    if (cur < 0) return;
    const next = cur + dir;
    if (next < 0 || next >= TAB_ORDER.length) return;
    router.navigate(`/${TAB_ORDER[next]}` as never);
  };

  const flingLeft = Gesture.Fling().runOnJS(true).direction(Directions.LEFT).onEnd(() => goRelative(1));
  const flingRight = Gesture.Fling().runOnJS(true).direction(Directions.RIGHT).onEnd(() => goRelative(-1));

  return (
    <GestureDetector gesture={Gesture.Exclusive(flingLeft, flingRight)}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}
