import { Platform } from 'react-native';

// 2026-07-18: healthy-shorts-assistant(2) 프로토타입으로 전면 다크 리스킨(Spotify풍 프리미엄
// 다크 테마) — 사용자 명시적 지시("그대로 가져와, 니맘대로 바꿔서 퀄리티 떨어트리지 말고")에 따라
// 원본 값을 최대한 그대로 이식. 기존 iOS 라이트 팔레트(#F2F2F7 배경 등)는 완전히 대체됐다 —
// PACE_ARCHITECTURE.md "비주얼 아이덴티티 전면 개편" 섹션 참고. primary(#5856D6, iOS 시스템
// 인디고)는 값 자체는 유지(신구 프로토타입 모두 동일 값 사용).
//
// ⚠️ 이 리스킨은 기존 "디자인 원칙(기획서 고정): No Gradients"를 명시적으로 오버라이드한다 —
// 아래 gradients export 및 하단 주석 참고. 사용자가 명시적으로 이 방향을 확정했다.
export const colors = {
  primary: '#5856D6', // iOS 시스템 인디고 — 값 불변
  primaryTint: '#5856D615',
  background: '#0B0C0F', // 앱 최외곽 배경 — App.tsx:261 실제 폰 프레임 배경(#060709는 그 바깥 웹페이지 배경일 뿐, 앱 배경 아님 — 이전에 착각해서 잘못 이식했었다)
  card: '#171A21', // 기본 카드/서피스
  cardMuted: '#09090B', // 뷰포트/플레이어 배경, 톤 다운된 서피스 — App.tsx:587 ShortsPlayer 풀스크린 배경(#09090B)
  cardDeep: '#0E1015', // 히어로 카드 그라데이션 종점
  success: '#10B981', // emerald-500
  successLight: '#34D399', // emerald-400 — 뱃지/아이콘 강조용
  successBg: 'rgba(16,185,129,0.1)',
  warning: '#F59E0B', // amber-500
  danger: '#EF4444', // red-500
  dangerLight: '#F87171', // red-400
  dangerBg: 'rgba(239,68,68,0.1)',
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF', // gray-400
  textTertiary: '#6B7280', // gray-500 — 눈썹 라벨 등 가장 옅은 텍스트
  border: 'rgba(255,255,255,0.08)', // 카드 외곽 하이라이트 보더
  borderSubtle: 'rgba(255,255,255,0.04)', // 헤어라인 구분선
  liveGreen: '#30D158', // Android 오버레이 "live" 표시 점
} as const;

// 플랫폼별 소스 강조색(ShortsPlayer/Home 플랫폼 카드용) — healthy-shorts-assistant(2)의
// getSourceMeta() 패턴 그대로.
export const sourceColors = {
  youtube: { accent: '#EF4444', gradientFrom: 'rgba(220,38,38,0.35)' }, // red-600/35
  instagram: { accent: '#EC4899', gradientFrom: 'rgba(219,39,119,0.35)' }, // pink-600/35
  tiktok: { accent: '#25F4EE', pink: '#FE2C55', yellow: '#FAC917', gradientFrom: 'rgba(13,148,136,0.35)' }, // teal-600/35
} as const;

// RN은 CSS 그라데이션이 없어 expo-linear-gradient가 필요 — 카드/버튼에 쓰는 좌표쌍만 상수화하고
// 실제 <LinearGradient> 사용은 각 컴포넌트에서. "No Gradients" 원칙을 이번 리스킨에서 의도적으로
// 오버라이드했으므로(위 주석 참고) 여기 정의된 조합만 승인된 그라데이션 — 임의 추가 금지.
export const gradients = {
  heroCard: [colors.card, colors.cardDeep] as const, // #171A21 → #0E1015
  heroCardAlt: ['#1A1D26', colors.cardDeep] as const,
  progressFill: [colors.primary, '#818CF8'] as const, // indigo → indigo-400
} as const;

export const radius = {
  card: 24,
  cardLarge: 28, // 오버레이 확장 카드 등
  button: 16,
  chip: 12,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

// 2026 타이포 트렌드 리서치 결과: 웰니스/미니멀 앱은 "Bouba grotesk"(둥글고 우호적인 그로테스크,
// Hanken Grotesk/General Sans 계열) 본문 + 모노스페이스 라벨/숫자 페어링이 주류 — Plus Jakarta Sans
// 도 같은 계열(둥근 그로테스크)이라 기존 기획을 그대로 유지, JetBrains Mono를 타이머·통계 숫자용
// 모노 폰트로 채택(위 트렌드의 "grotesk + mono" 페어링과 정확히 일치). @expo-google-fonts로 로드
// (app/_layout.tsx의 useFonts) — zen-master/jlpt-master는 커스텀 본문 폰트를 쓰지 않지만(시스템 폰트
// 의존), Pace는 프로토타입 단계에서부터 이 폰트 스택을 명시했으므로 그대로 실제 로드까지 완료.
// 본문 폰트는 Inter(healthy-shorts-assistant(1) 프로토타입과 동일 페어링: Inter 본문 +
// Plus Jakarta Sans는 히어로 헤드라인 1~2곳 전용 + JetBrains Mono 숫자 전용). Inter Regular는
// app/_layout.tsx에서 Text.defaultProps로 전역 기본값 처리 — 아래 굵기 변형은 커스텀 폰트가
// fontWeight prop을 무시하는(특히 iOS) 문제 때문에 굵은 텍스트가 필요한 자리에 명시적으로
// fontFamily를 지정하기 위한 것.
export const typography = {
  displayFontFamily: 'PlusJakartaSans_800ExtraBold',
  displayFontFamilyBold: 'PlusJakartaSans_700Bold',
  displayFontFamilySemibold: 'PlusJakartaSans_600SemiBold',
  monoFontFamily: 'JetBrainsMono_500Medium', // 타이머/통계 숫자용
  monoFontFamilyBold: 'JetBrainsMono_700Bold',
  bodyFontFamily: 'Inter_400Regular',
  bodyFontFamilyMedium: 'Inter_500Medium',
  bodyFontFamilySemibold: 'Inter_600SemiBold',
  bodyFontFamilyBold: 'Inter_700Bold',
  bodyFontFamilyExtrabold: 'Inter_800ExtraBold',
  bold: '700' as const,
  extrabold: '800' as const,
  semibold: '600' as const,
  regular: '400' as const,
};

// healthy-shorts-assistant(1) 리서치 결과: 모든 카드가 테두리(border-[#E5E5EA]) + 아주 옅은
// shadow-xs를 항상 함께 쓴다 — Pace 카드들은 지금까지 border만 있고 shadow가 전혀 없었다(이것도
// "밋밋해 보인다"는 인상의 원인). "No 3D/No Neumorphism" 원칙과 충돌하지 않는 선(옅은 1px급
// soft shadow, 입체감이 아니라 미세한 부양감만)에서 카드 공통 그림자 토큰화.
export const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.04,
  shadowRadius: 3,
  elevation: 1,
} as const;

// 오버레이 바/확장 카드처럼 정해진 배경이 아니라 임의의 영상 콘텐츠 위에 떠 있는 요소용 —
// healthy-shorts-assistant(1)의 오버레이 그림자(0 24px 60px -15px rgba(0,0,0,0.85))에 대응.
export const floatingShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.25,
  shadowRadius: 20,
  elevation: 8,
} as const;

// 디자인 원칙(기획서 고정): Flat, No Gradients, No 3D, No Neumorphism, No Glassmorphism, Large Cards, Minimal UI
// 오버레이 전용 원칙은 PACE_ARCHITECTURE.md "오버레이 UI 원칙 — 하지 말 것" 참고.
// 예외: (tabs)/_layout.tsx의 iOS 탭바 블러는 카드/콘텐츠가 아니라 "시스템 크롬"이라 이 원칙 밖 —
// iOS 26 Liquid Glass 네이티브 컨벤션을 따르기 위한 의도적 예외(PACE_ARCHITECTURE.md 참고).

// (tabs)/_layout.tsx가 iOS에서 탭바를 position:'absolute'(플로팅 블러)로 띄우면서 화면 콘텐츠가
// 탭바 밑에 깔리게 된다 — 각 탭 화면의 ScrollView contentContainerStyle paddingBottom에 더해서
// 탭바에 안 가리게 하는 여백. Android는 탭바가 일반 문서 흐름(non-absolute)이라 추가 여백 불필요.
// jlpt-master/zen-master가 각 화면에서 Math.max(insets.bottom + N, floor) 형태로 직접 계산하던
// 패턴 대신, Pace는 탭 4개 화면이 전부 이 값 하나로 충분해 상수 하나로 단순화했다.
export const layout = {
  tabBarContentClearance: Platform.OS === 'ios' ? 96 : 24,
} as const;

// 바텀시트/모달의 paddingBottom — jlpt-master/zen-master의 AppAlertSheet.tsx·ErrorBottomSheet.tsx가
// 쓰던 "(Platform.OS === 'ios' ? 52 : 36) + insets.bottom" 관용구 그대로. 홈 인디케이터가 있는
// 기기(iPhone X 이후)는 insets.bottom이 자동으로 그 높이를 반영하고, 없는 기기(하드웨어 홈버튼/
// 3버튼 내비게이션)는 0이라 offset만 남는다 — 기기별로 값을 하드코딩하지 않고 이 함수 하나로
// 처리. 호출부에서 `useSafeAreaInsets().bottom`을 넘겨야 한다(훅이라 theme.ts 안에선 직접 호출 불가).
export function bottomSheetPadding(insetsBottom: number): number {
  return (Platform.OS === 'ios' ? 52 : 36) + insetsBottom;
}
