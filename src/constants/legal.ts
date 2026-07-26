// App Store 심사 요건(Guideline 3.1.2 자동갱신 구독 / 5.1.1 계정) — 구독을 파는 앱은 이용약관(EULA)과
// 개인정보처리방침 링크가 "바이너리 안"에 있어야 하고, 두 URL은 심사원이 실제로 열어 확인하므로 반드시
// 정상 응답해야 한다(404/빈 페이지면 거부).
//
// 이용약관: 자체 약관이 없으면 Apple 표준 EULA를 써도 Apple이 허용한다(App Store Connect에서 별도 EULA를
// 지정하지 않으면 이게 기본 적용되는 바로 그 문서). 그대로 사용.
export const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

// ⚠️⚠️ 사장님 — 제출 전 필수 교체: 실제로 호스팅된 개인정보처리방침 페이지 URL로 바꿔야 한다. 지금 값은
// 임시 placeholder이며, 이 URL이 정상적으로 열리지 않으면 App Store 심사에서 거부된다(B1/B2 블로커의 유일한
// 미완 부분 — 나머지 UI/고지/약관은 코드로 완비됨). 개인정보처리방침 페이지를 하나 호스팅(예: 간단한 정적
// 페이지, GitHub Pages/Notion 공개페이지/백엔드 라우트 등)한 뒤 그 URL을 여기 넣으면 된다.
export const PRIVACY_POLICY_URL = 'https://pace-app.notion.site/privacy'; // TODO(owner): 실제 URL로 교체
