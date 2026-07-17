// 의도적으로 로케일 무관 — 시스템 오버레이(Android pill)/Live Activity 프레임(iOS)은 화면이 매우
// 좁아 "23m Left"처럼 극도로 압축된 표기가 필요하고, 이런 카운트다운 표기는 한국어 UI에서도
// 그대로 영문으로 두는 게 자연스럽다(PACE_ARCHITECTURE.md i18n 섹션 "원칙" 참고).
export function formatRemaining(minutes: number): string {
  if (minutes <= 0) return '0m Left';
  return `${minutes}m Left`;
}
