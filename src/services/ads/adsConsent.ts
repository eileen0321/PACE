// 2026-08-03 — EEA/영국 광고 동의(GDPR, IAB TCF v2.2).
//
// 배경: 구글은 2024-01-16부터 EEA·영국 사용자에게 광고를 서빙하려면 구글 인증 CMP로 동의를 받도록
// 의무화했다. **비개인화 광고(requestNonPersonalizedAdsOnly)도 면제 대상이 아니다** — 개인화 여부와
// 무관하게 동의가 필요하다. 이 배선이 없으면 해당 지역에서 광고가 사실상 안 나가고 정책 위반 소지도
// 있다. SDK를 새로 넣을 필요는 없다: react-native-google-mobile-ads가 이미
// `com.google.android.ump:user-messaging-platform`을 번들하고 `AdsConsent`를 노출한다.
// 앱에 없던 것은 "호출"뿐이었다.
//
// 구현은 구글 공식 문서(https://developers.google.com/admob/android/privacy)의 순서를 따른다:
//   requestInfoUpdate  →  loadAndShowConsentFormIfRequired  →  canRequestAds 확인  →  그때부터 광고 요청
// `gatherConsent()`가 앞의 두 단계를 그대로 감싼 공식 헬퍼라 이걸 쓴다(직접 두 번 호출하는 것과 동일).
//
// 문서가 명시한 두 가지 중요한 점:
// - **매 앱 실행마다** requestInfoUpdate를 불러야 한다. 동의 상태나 재동의 필요 여부가 서버 쪽에서
//   바뀔 수 있기 때문이다.
// - **canRequestAds()는 requestInfoUpdate를 부르기 전까지 항상 false다.** 그래서 "동의 안 받았음"과
//   "아직 안 물어봤음"을 구분하지 않고, 이 값이 true가 되기 전에는 광고를 요청하지 않는다.
//
// EEA 밖(한국 등)에서는 동의가 불필요해 폼이 안 뜨고 canRequestAds가 바로 true가 된다 — 지역 분기를
// 우리가 직접 할 필요가 없다(지역 판정은 SDK가 한다).
//
// 다른 광고 파일들과 동일한 방어적 require — 네이티브 미링크(재빌드 전) 상태에서도 앱이 안 죽어야 한다.
import { TEST_DEVICE_IDS } from './adsConfig';

type ConsentModule = typeof import('react-native-google-mobile-ads');

let AdsConsent: ConsentModule['AdsConsent'] | null = null;
let PrivacyOptionsStatus: ConsentModule['AdsConsentPrivacyOptionsRequirementStatus'] | null = null;
let DebugGeography: ConsentModule['AdsConsentDebugGeography'] | null = null;
try {
  const mod = require('react-native-google-mobile-ads');
  AdsConsent = mod.AdsConsent ?? null;
  PrivacyOptionsStatus = mod.AdsConsentPrivacyOptionsRequirementStatus ?? null;
  DebugGeography = mod.AdsConsentDebugGeography ?? null;
} catch (e) {
  console.warn('[adsConsent] 네이티브 모듈 미링크 — 동의 흐름 스킵:', e);
}

// 2026-08-03 — 개발 빌드에서만 "EEA 사용자인 척" 강제해 동의 폼을 실제로 띄워 검증한다. 한국에서
// 개발하면 SDK가 정상적으로 "동의 불필요"로 답해버려서, 이 옵션 없이는 유럽 사용자 경로를 한 번도
// 못 보고 출시하게 된다(전 세계 대상이므로 반드시 검증해야 하는 경로).
//
// 실기기는 testDeviceIdentifiers에 등록돼 있어야 디버그 지역이 먹는다(에뮬레이터는 자동 허용).
// 기기 해시 ID는 adsConfig.ts의 TEST_DEVICE_IDS를 그대로 쓴다 — 광고 테스트기기와 같은 값이다.
// 새 기기는 logcat 태그 "Ads"의 "Use RequestConfiguration.Builder().setTestDeviceIds(...)" 메시지에서
// 찾아 그쪽에 추가하면 여기도 같이 적용된다.
//
// __DEV__ 게이트라 릴리즈 번들에는 이 분기 자체가 상수 폴딩으로 사라진다 — 실제 사용자에게 잘못된
// 지역이 적용될 위험이 없다.
function debugOptions() {
  if (!__DEV__ || !DebugGeography) return undefined;
  return {
    debugGeography: DebugGeography.EEA,
    testDeviceIdentifiers: TEST_DEVICE_IDS,
  };
}

export type AdsConsentResult = {
  /** 이 값이 true가 되기 전에는 배너/보상형을 로드하면 안 된다. */
  canRequestAds: boolean;
  /** 설정에 "광고 개인정보 설정" 진입점을 보여야 하는가(TCF 요구사항). */
  privacyOptionsRequired: boolean;
};

/**
 * 앱 시작 시 1회(콜드 스타트마다). 동의 정보를 갱신하고 필요하면 폼을 띄운 뒤 결과를 돌려준다.
 *
 * **호출 시점 주의** — 스플래시가 끝나고 화면이 다 그려진 뒤에 부를 것(_layout.tsx 참고).
 * 부팅 중에 부르면 스플래시 위로 폼이 겹쳐 뜨고, 구글 문서도 "Activity/View 컨텍스트가 준비된 뒤
 * 시작해야 첫 실행에서 깜빡임이 없다"고 권고한다.
 *
 * 절대 throw하지 않는다 — 폼 로딩 실패(네트워크 등)로 앱 부팅이 막히면 안 된다. 실패 시
 * canRequestAds=false로 돌려주므로 광고를 안 띄울 뿐, 임의로 우회하지 않는다.
 */
export async function ensureAdsConsent(): Promise<AdsConsentResult> {
  if (!AdsConsent) {
    // 네이티브 모듈이 없으면 광고 자체가 없다 — 게이팅이 의미 없으므로 true로 열어둔다(광고 컴포넌트
    // 쪽에서 모듈 부재를 이미 따로 처리한다). false로 두면 모듈 미링크 개발 빌드에서 배너 자리가
    // 영영 안 잡혀 레이아웃 디버깅이 어려워진다.
    return { canRequestAds: true, privacyOptionsRequired: false };
  }
  try {
    // requestInfoUpdate + loadAndShowConsentFormIfRequired를 합친 공식 헬퍼.
    // 동의가 필요 없는 지역이면 폼 없이 즉시 반환된다.
    const info = await AdsConsent.gatherConsent(debugOptions());
    const result = {
      canRequestAds: info.canRequestAds === true,
      privacyOptionsRequired:
        PrivacyOptionsStatus != null &&
        info.privacyOptionsRequirementStatus === PrivacyOptionsStatus.REQUIRED,
    };
    if (__DEV__) {
      // 검증용 — 폼이 안 떴을 때 "동의가 불필요한 지역으로 판정됐는지" vs "폼 자체가 없는지"를
      // 구분해야 원인을 찾을 수 있다(라이브러리 이슈 #807: 디버그 지역이 EEA인데도 폼이 없다고
      // 나오는 사례 — 대부분 AdMob 콘솔에 GDPR 메시지가 게시 안 됐거나 기기 미등록이 원인).
      console.log(
        '[adsConsent] status=' + info.status +
        ' formAvailable=' + info.isConsentFormAvailable +
        ' canRequestAds=' + info.canRequestAds +
        ' privacyOptions=' + info.privacyOptionsRequirementStatus
      );
    }
    return result;
  } catch (e) {
    console.warn('[adsConsent] 동의 흐름 실패(광고만 영향, 앱은 계속):', e);
    return { canRequestAds: false, privacyOptionsRequired: false };
  }
}

/** 설정에서 "광고 개인정보 설정"을 눌렀을 때 — 동의 폼을 다시 띄운다. */
export async function showAdsPrivacyOptions(): Promise<void> {
  if (!AdsConsent) return;
  try {
    await AdsConsent.showPrivacyOptionsForm();
  } catch (e) {
    console.warn('[adsConsent] showPrivacyOptionsForm 실패:', e);
  }
}
