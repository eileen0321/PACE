import type { PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import { usePathname, useRouter } from 'expo-router';

// 2026-08-01 사장님 지시 — iOS 탭(홈/집중/분석/설정) 좌우 스와이프. 하단탭 네비게이터(@react-navigation/
// bottom-tabs)는 스와이프를 기본 미지원이라, 화면 위에 좌우 Fling(빠른 좌우 플릭) 제스처를 얹어 인접 탭으로
// 이동한다. Fling은 방향(수평)이 명확해 화면 내부의 세로 ScrollView·탭과 경쟁하지 않는다(탭/세로 스크롤 보존).
// Android는 TabSwipeArea.tsx(패스스루) — 스와이프 구현을 OS별로 분리(jlpt-master 방식).
const TAB_ORDER = ['home', 'focus', 'stats', 'settings'];

export function TabSwipeArea({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const router = useRouter();
  const pathname = usePathname();

  const goRelative = (dir: 1 | -1) => {
    // pathname 예: '/home' | '/focus' … — 탭 이름 포함 여부로 현재 인덱스 판정(이름 간 부분문자열 겹침 없음).
    const cur = TAB_ORDER.findIndex((name) => pathname.includes(name));
    if (cur < 0) return;
    const next = cur + dir;
    if (next < 0 || next >= TAB_ORDER.length) return; // 양 끝에서는 더 안 넘어감
    router.navigate(`/${TAB_ORDER[next]}` as never);
  };

  // runOnJS(true): onEnd 콜백을 JS 스레드에서 실행 → router를 워클릿 래핑 없이 바로 호출.
  const flingLeft = Gesture.Fling().runOnJS(true).direction(Directions.LEFT).onEnd(() => goRelative(1));
  const flingRight = Gesture.Fling().runOnJS(true).direction(Directions.RIGHT).onEnd(() => goRelative(-1));

  return (
    <GestureDetector gesture={Gesture.Exclusive(flingLeft, flingRight)}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}
