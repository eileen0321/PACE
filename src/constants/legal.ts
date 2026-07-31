// App Store 심사 요건(Guideline 3.1.2 자동갱신 구독 / 5.1.1 계정) — 구독을 파는 앱은 이용약관(EULA)과
// 개인정보처리방침 링크가 "바이너리 안"에 있어야 하고, 두 URL은 심사원이 실제로 열어 확인하므로 반드시
// 정상 응답해야 한다(404/빈 페이지면 거부).
//
// 2026-07-31 사장님이 자체 이용약관 페이지(Notion 공개) 제공 — 이전엔 자체 약관이 없어 Apple 표준
// EULA를 대신 썼는데, 이게 Android 사용자에게도 그대로 노출돼(공용 코드) "iTunes Store 약관" 페이지가
// 뜨는 문제가 있었음(양 플랫폼 공용이므로 자체 약관으로 교체하는 게 정답). 이제 양 플랫폼 다 이 URL 사용.
export const TERMS_OF_USE_URL = 'https://mini-gull-13a.notion.site/PACE-3ad2e806c9c780c5b3c5ec62b55f5aa9?pvs=73';

// 2026-07-31 사장님이 새 개인정보처리방침 페이지(Notion 공개, *.notion.site) 제공 — 페이월/설정의
// 링크가 이 URL을 연다.
export const PRIVACY_POLICY_URL = 'https://mini-gull-13a.notion.site/PACE-3ad2e806c9c7804fa5dbdadc88dd56f3?pvs=73';
