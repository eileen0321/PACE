// 2026-07-26 사용자 지시 — AdMob 실제 광고 단위 ID를 출시 전(테스트 단계)부터 쓰기 시작하면서,
// 개발용 기기에서 실수로 실제 광고를 보거나 탭하면 무효 트래픽(invalid traffic)으로 간주돼 AdMob
// 계정이 정지될 수 있다는 지적을 받았다 — Google 공식 권장 대응은 "테스트 기기 등록": 실제 광고
// 단위 ID는 코드에 그대로 두되, 등록된 기기에서는 SDK가 항상 테스트 광고만 내려주게 만든다.
// AdBanner.tsx/rewardedAd.ts와 동일한 방어적 require 패턴 — 네이티브 모듈 미링크 시 조용히 스킵.
let MobileAds: typeof import('react-native-google-mobile-ads').default | null = null;
try {
  MobileAds = require('react-native-google-mobile-ads').default;
} catch (e) {
  console.warn('[adsConfig] react-native-google-mobile-ads 네이티브 모듈 미링크 — 테스트기기 설정 스킵:', e);
}

// adb logcat(태그 "Ads")에서 "Use RequestConfiguration.Builder().setTestDeviceIds(...)" 메시지로
// 확인한 실제 개발/테스트 기기 ID들. 새 기기로 테스트할 땐 그 기기의 로그에서 같은 메시지를 찾아
// 여기 추가할 것 — 등록 안 된 기기는 실제 광고가 그대로 나가니 광고를 절대 직접 탭하지 말 것.
const TEST_DEVICE_IDS = [
  '2C52B7069678FD3FAD58A503E0369A3D', // Galaxy Note20 (R3CN80S5GWW) — 2026-07-26 확인
];

export function configureAdsForTesting(): void {
  if (!MobileAds) return;
  MobileAds()
    .setRequestConfiguration({ testDeviceIdentifiers: TEST_DEVICE_IDS })
    .catch((e) => console.warn('[adsConfig] setRequestConfiguration 실패:', e));
}
