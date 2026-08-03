import { create } from 'zustand';

// 2026-08-03 — EEA/영국 GDPR 동의(UMP) 결과를 앱 전역에서 공유한다.
//
// 구글 문서 기준으로 두 가지를 나눠서 들고 있어야 한다:
// - `canRequestAds` — 이게 true가 되기 전에는 배너/보상형을 **로드**하면 안 된다. 반대로 SDK 초기화
//   (mobileAds().initialize())는 개인정보를 처리하지 않으므로 동의 전에 불러도 정책상 문제없다.
//   즉 막아야 하는 건 초기화가 아니라 광고 요청이다.
//   ⚠️ UMP의 canRequestAds()는 requestInfoUpdate를 부르기 전까지 **항상 false**라, 초기값 false는
//   "동의 거부"가 아니라 "아직 안 물어봤음"을 뜻한다. 그래서 기본값을 false로 두는 게 맞다.
// - `privacyOptionsRequired` — 설정에 "광고 개인정보 설정" 진입점을 노출할지. TCF는 한 번 동의한
//   뒤에도 언제든 바꿀 수 있는 진입점을 요구하지만, EEA 밖 사용자에게 띄우면 눌러도 아무 일이
//   안 일어나 고장난 메뉴처럼 보인다 — SDK가 REQUIRED로 답할 때만 보여준다.
//
// 동의 흐름 자체는 스플래시가 끝나고 화면이 다 그려진 뒤에 시작한다(_layout.tsx). 그 사이 배너가
// 먼저 광고를 요청해버리면 안 되므로 기본값이 false다.
type AdsConsentState = {
  canRequestAds: boolean;
  privacyOptionsRequired: boolean;
  setConsent: (v: { canRequestAds: boolean; privacyOptionsRequired: boolean }) => void;
};

export const useAdsConsentStore = create<AdsConsentState>((set) => ({
  canRequestAds: false,
  privacyOptionsRequired: false,
  setConsent: ({ canRequestAds, privacyOptionsRequired }) =>
    set({ canRequestAds, privacyOptionsRequired }),
}));
