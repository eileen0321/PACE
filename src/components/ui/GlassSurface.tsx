import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

// zen-master/jlpt-master의 GlassSurface.tsx 패턴 그대로 이식(PACE_ARCHITECTURE.md "비주얼
// 아이덴티티 전면 개편" 참고) — iOS는 실제 BlurView 블러, Android는 평평한 반투명 색상으로
// 대체한다. Android에서 실제 블러(experimentalBlurMethod=dimezisBlurView)를 썼을 때 자식 텍스트
// 까지 같이 흐려지는 문제가 있어(두 자매 프로젝트가 실제로 겪고 문서화한 이슈) 텍스트 위에 블러가
// 얹히는 조합은 Android에서 항상 피한다 — "최고급 트렌드"라도 가독성을 깨는 트렌드는 채택하지 않음.
export function GlassSurface({
  intensity = 40,
  tint = 'dark',
  fallbackColor = 'rgba(23,26,33,0.85)', // colors.card 근사 반투명(Android/웹 폴백)
  style,
  children,
}: {
  intensity?: number;
  tint?: 'light' | 'dark';
  fallbackColor?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={intensity} tint={tint === 'dark' ? 'systemMaterialDark' : 'systemMaterialLight'} style={style}>
        {children}
      </BlurView>
    );
  }
  return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
}
