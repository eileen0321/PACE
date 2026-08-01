import type { PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

// 기본(Android/웹) — 탭 좌우 스와이프는 iOS 전용(TabSwipeArea.ios.tsx). 여기선 컨테이너만 그대로 렌더한다.
// (플랫폼 분리 원칙: 스와이프 제스처 구현은 OS별로 나눈다 — Android 탭 전환 동작은 건드리지 않음.)
export function TabSwipeArea({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={style}>{children}</View>;
}
