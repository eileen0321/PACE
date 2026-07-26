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
    // ⚠️ 감사 발견 — 호출부(stats.tsx 등)가 넘기는 styles.card/gridCard/divideCard가 전부
    // colors.card(불투명 hex, 알파 없음)를 backgroundColor로 갖고 있어서, style을 그대로 BlurView에
    // 씌우면 불투명 배경이 블러 위를 그대로 덮어 블러 효과가 아예 안 보였다(Home만 화려하고 Stats는
    // 늘 flat하게 보이던 원인). style 배열 뒤에 투명 배경을 덧씌워 블러가 실제로 비치게 한다.
    return (
      <BlurView intensity={intensity} tint={tint === 'dark' ? 'systemMaterialDark' : 'systemMaterialLight'} style={[style, { backgroundColor: 'transparent' }]}>
        {children}
      </BlurView>
    );
  }
  return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
}
