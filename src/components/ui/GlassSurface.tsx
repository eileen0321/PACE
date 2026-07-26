import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

// zen-master/jlpt-master의 GlassSurface.tsx 패턴 그대로 이식(PACE_ARCHITECTURE.md "비주얼
// 아이덴티티 전면 개편" 참고) — iOS는 실제 BlurView 블러, Android는 원래 평평한 반투명 색상으로만
// 대체했었다(2026-07-26까지).
//
// 2026-07-27 사용자 재지적("글래스모피즘 한 거 맞아?") — 이 세션(Windows/Android)에서 실기기로 계속
// 확인하는데도 아무 변화가 없다고 느낀 진짜 원인을 여기서 찾았다: 위 "iOS는 블러/Android는 폴백"
// 분기 자체가 애초에 Android에서는 블러를 전혀 안 그리는 구조였다 — 즉 지난번 "iOS 블러가 불투명
// 배경에 가려지던 버그" 수정은 iOS 전용이라 Android 화면(사장님이 실제로 보고 있는 화면)엔 처음부터
// 아무 영향이 없었다. Android에서 진짜 블러를 안 쓴 이유(주석 기록 그대로 보존): BlurView가 children을
// 감싸면(부모로 쓰면) 텍스트까지 같이 흐려지는 문제가 있었다. 해결책은 "BlurView를 부모로 감싸지
// 않고, 배경 레이어로만 절대위치 배치 + 실제 콘텐츠(children)는 그 형제로 블러 밖에서 그리기" —
// BlurView가 블러하는 대상은 "그 뒤에 이미 그려진 것"(z-order상 아래)뿐이라, children을 BlurView의
// 자식이 아니라 형제(뒤에 그려짐)로 두면 텍스트는 전혀 안 흐려지면서 배경만 진짜로 블러된다.
export function GlassSurface({
  intensity = 40,
  tint = 'dark',
  fallbackColor = 'rgba(23,26,33,0.85)', // colors.card 근사 반투명(블러 위에 얹는 틴트, 웹 폴백)
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
    // 씌우면 불투명 배경이 블러 위를 그대로 덮어 블러 효과가 아예 안 보였다. style 배열 뒤에 투명
    // 배경을 덧씌워 블러가 실제로 비치게 한다.
    return (
      <BlurView intensity={intensity} tint={tint === 'dark' ? 'systemMaterialDark' : 'systemMaterialLight'} style={[style, { backgroundColor: 'transparent' }]}>
        {children}
      </BlurView>
    );
  }
  if (Platform.OS === 'android') {
    return (
      <View style={[style, { backgroundColor: 'transparent', overflow: 'hidden' }]}>
        <BlurView
          intensity={intensity}
          tint={tint}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        {/* 블러 위에 얹는 반투명 틴트 — 블러만으로는 색이 너무 밝게(뒤 배경 색 그대로) 비쳐서
            카드라는 게 안 읽힌다. children보다 먼저 그려서 텍스트 위에 안 얹힌다. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: fallbackColor }]} />
        {children}
      </View>
    );
  }
  // 웹 등 그 외 플랫폼 폴백 — 기존과 동일.
  return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
}
