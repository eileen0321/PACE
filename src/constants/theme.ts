// healthy-shorts-assistant(AI Studio 프로토타입) UI를 포팅하며 iOS 시스템 팔레트로 갱신.
// 원 기획서의 #4F46E5 대신 iOS 시스템 인디고(#5856D6)를 채택 — Apple Fitness/Screen Time과
// 시각적으로 더 가깝고, 프로토타입에서 이미 검증된 값이라 그대로 승계한다.
export const colors = {
  primary: '#5856D6', // iOS system indigo
  primaryTint: '#5856D615', // 15% 투명도 배경 (뱃지/필 배경용)
  background: '#F2F2F7', // iOS systemGroupedBackground
  card: '#FFFFFF',
  cardMuted: '#F9F9FB', // 통계 카드 등 살짝 톤 다운된 카드
  success: '#22C55E',
  successBg: '#E8F5E9',
  warning: '#F59E0B',
  danger: '#EF4444',
  dangerBg: '#FEF2F2',
  textPrimary: '#1C1C1E',
  textSecondary: '#8E8E93',
  border: '#E5E5EA',
} as const;

export const colorsDark = {
  primary: '#7A79E0',
  primaryTint: '#7A79E025',
  background: '#000000',
  card: '#1C1C1E',
  cardMuted: '#151517',
  success: '#22C55E',
  successBg: '#1B2E20',
  warning: '#F59E0B',
  danger: '#EF4444',
  dangerBg: '#2E1B1B',
  textPrimary: '#F5F5F7',
  textSecondary: '#8E8E93',
  border: '#2A2A31',
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

// 프로토타입의 폰트 스택(Inter/Plus Jakarta Sans/JetBrains Mono)을 RN에선 expo-font로 로드해야
// 실제 적용된다 — 폰트 파일 추가 전까지는 시스템 기본 폰트로 폴백(fontFamily 미지정).
export const typography = {
  displayFontFamily: undefined as string | undefined, // 로드 후 'PlusJakartaSans-ExtraBold' 등으로 교체
  monoFontFamily: undefined as string | undefined, // 로드 후 'JetBrainsMono-Medium' 등으로 교체(숫자/타이머용)
  bold: '700' as const,
  extrabold: '800' as const,
  semibold: '600' as const,
  regular: '400' as const,
};

// 디자인 원칙(기획서 고정): Flat, No Gradients, No 3D, No Neumorphism, No Glassmorphism, Large Cards, Minimal UI
// 오버레이 전용 원칙은 PACE_ARCHITECTURE.md "오버레이 UI 원칙 — 하지 말 것" 참고.
