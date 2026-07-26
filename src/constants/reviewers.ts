// ── 앱스토어/플레이스토어 심사관 화이트리스트 (jlpt-master src/config/reviewers.ts 이식) ──────
// 이 이메일로 소셜 로그인하면 RC(RevenueCat) 응답과 무관하게 로컬 프리미엄을 부여한다.
// 심사관에게 제출한 테스트 계정 이메일을 여기에 등록할 것 — 히든 리뷰어 링크 없이, 일반 유저의
// 프리미엄 우회 경로를 원천 차단하는 방식(화이트리스트 자체가 클라이언트 번들에 포함되므로
// 절대 유출되면 안 되는 시크릿은 넣지 않는다 — 이메일 매칭만 하는 로컬 판정용).
// 2026-07-26 사용자 지시 — jlpt-master(src/config/reviewers.ts)가 이미 구글 플레이 콘솔
// [앱 액세스 권한]에 제출해둔 실제 테스트 계정을 그대로 재사용(신규 심사 계정 발급 불필요).
export const REVIEWER_EMAILS: string[] = [
  's7.reviewer@gmail.com',
];

export function isReviewerEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return REVIEWER_EMAILS.some((r) => r.toLowerCase() === e);
}
