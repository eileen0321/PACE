// App Store 심사 요건(Guideline 3.1.2 자동갱신 구독 / 5.1.1 계정) — 구독을 파는 앱은 이용약관(EULA)과
// 개인정보처리방침 링크가 "바이너리 안"에 있어야 하고, 두 URL은 심사원이 실제로 열어 확인하므로 반드시
// 정상 응답해야 한다(404/빈 페이지면 거부).
//
// 이용약관: 자체 약관이 없으면 Apple 표준 EULA를 써도 Apple이 허용한다(App Store Connect에서 별도 EULA를
// 지정하지 않으면 이게 기본 적용되는 바로 그 문서). 그대로 사용.
export const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

// 2026-07-27 사장님이 실제 개인정보처리방침 페이지(Notion 공개) 제공 — 페이월/설정의 링크가 이 URL을 연다.
export const PRIVACY_POLICY_URL = 'https://mini-gull-13a.notion.site/PACE-3a72e806c9c780c3b4c5fc24f1264447';
