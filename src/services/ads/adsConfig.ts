import { Platform } from 'react-native';

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
export const TEST_DEVICE_IDS = [
  '2C52B7069678FD3FAD58A503E0369A3D', // Galaxy Note20 (R3CN80S5GWW) — 2026-07-26 확인
];

// 2026-08-04 사장님 지적("출시앱에 광고가 아예 안 뜬다") 조사 중 발견 — 이 함수는 `__DEV__`와 무관하게
// 무조건 실행되고 있었다(_layout.tsx 최상단). 즉 **출시빌드에서도** 위 목록의 기기는 영원히 테스트
// 광고만 받는다. 개발 중엔 그게 목적이었지만 출시 후에는 두 가지가 문제다:
//   1. 실제 수익이 나야 할 기기(사장님 폰)에서 실광고가 원천적으로 안 나간다.
//   2. "출시앱에서 광고가 제대로 나오는지" 검증 자체가 불가능하다 — 무엇을 봐도 테스트 광고다.
// 그래서 기본값을 뒤집는다: 개발 빌드에서는 예전처럼 항상 보호하고, 출시빌드에서는 등록하지 않는다.
//
// 출시와 동일한 빌드를 자기 폰에서 안전하게 확인하고 싶을 때만 `EXPO_PUBLIC_AD_TEST_DEVICES=true`로
// 빌드하면 보호가 그대로 살아난다(실 단위 ID + 테스트 광고). eas.json의 production 프로필에는
// 이 값을 넣지 않는다 — 넣는 순간 실사용자 수익이 0이 된다.
const FORCE_TEST_DEVICES = process.env.EXPO_PUBLIC_AD_TEST_DEVICES === 'true';

// 🔴 2026-08-11 — "실광고를 쓸 것인가"의 **단일 판정처**. 이 값을 rewardedAd/AdBanner/_layout이
//   전부 import해서 쓴다. 오늘(8/10~11) 이 판정이 세 파일에 각각 복붙돼 있다가 한쪽만 고쳐져
//   갈라진 일이 실제로 있었고(de02499가 세 곳을 동시에 고쳐야 했던 이유), 같은 종류의 사고를
//   Focus Session 타이머에서도 하루 종일 겪었다. 규칙은 한 곳에만 둔다.
//
// ── 왜 `!__DEV__`만으로는 안 되는가 ──
//   같은 소스에서 릴리즈 빌드가 **두 종류** 나오는데 요구가 정반대다:
//     · Android 비공개 테스트 트랙 → **테스트 광고**여야 한다.
//       테스터 클릭이 무효 트래픽(invalid traffic)으로 잡히면 AdMob 계정이 정지된다.
//       2026-08-10에 실광고를 올렸다가 versionCode 7→8→9로 되돌린 사고가 정확히 이것이다.
//     · iOS 프로덕션 → **실광고**여야 한다. 실사용자에게 테스트 광고는 정책 위반이고 수익이 0이다.
//   둘 다 `__DEV__ === false`라 이 플래그로는 구분이 불가능하다. 그렇다고
//   EXPO_PUBLIC_AD_TEST_DEVICES(.env 전역)를 켜면 iOS 프로덕션까지 테스트 광고가 되어
//   de02499가 고친 "수익 0"이 도로 살아난다 — 한쪽을 맞추면 반드시 다른 쪽이 틀리는 상태였다.
//
// ── 그래서 플랫폼별 기본값을 **현재 출시 상태에 맞춘다** ──
//   iOS는 이미 프로덕션 출시본이 있으므로 릴리즈 = 실광고(맥 수정 유지).
//   Android는 아직 **비공개 테스트 트랙만** 존재하므로 릴리즈여도 기본이 테스트 광고다.
//   안드로이드가 프로덕션에 올라가는 날 `EXPO_PUBLIC_ANDROID_REAL_ADS=true`로 빌드하면 된다.
//   ⚠️ 기본값을 이 방향으로 잡은 이유: 잊어버렸을 때 생기는 손해가 비대칭이다.
//     실광고를 테스트 트랙에 실으면 **계정 정지**(복구 불가에 가까움), 반대는 그 빌드의 수익이
//     잠깐 0일 뿐이다. 되돌릴 수 있는 쪽으로 틀리게 만든다.
const ANDROID_REAL_ADS_OPT_IN = process.env.EXPO_PUBLIC_ANDROID_REAL_ADS === 'true';

export const USE_REAL_ADS: boolean =
  !__DEV__ && !FORCE_TEST_DEVICES && (Platform.OS !== 'android' || ANDROID_REAL_ADS_OPT_IN);

export function configureAdsForTesting(): void {
  if (!MobileAds) return;
  if (!__DEV__ && !FORCE_TEST_DEVICES) return;
  MobileAds()
    .setRequestConfiguration({ testDeviceIdentifiers: TEST_DEVICE_IDS })
    .catch((e) => console.warn('[adsConfig] setRequestConfiguration 실패:', e));
}
