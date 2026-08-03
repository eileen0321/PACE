import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { colors } from '../../constants/theme';
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { useAdsConsentStore } from '../../store/useAdsConsentStore';

// 2026-07-25 — react-native-google-mobile-ads는 네이티브 코드가 있는 모듈이라 네이티브 재빌드
// 전에는(예: 지금처럼 AdMob 라이브러리와 Kotlin 버전 충돌로 빌드가 아직 안 끝난 경우) 설치된 APK에
// 이 모듈이 없다 — 그런데도 상위 화면(home.tsx)이 최상단에서 정적 import를 하면
// TurboModuleRegistry.getEnforcing에서 "모듈을 못 찾음" 크래시가 나서 Home 화면 전체가 죽는다.
// bluetoothService.android.ts 등 기존 네이티브 모듈들과 동일한 방어적 require 패턴을 그대로 따라
// 배너 하나 때문에 앱 전체가 안 뜨는 일이 없게 한다.
let BannerAd: typeof import('react-native-google-mobile-ads').BannerAd | null = null;
let BannerAdSize: typeof import('react-native-google-mobile-ads').BannerAdSize | null = null;
let TestIds: typeof import('react-native-google-mobile-ads').TestIds | null = null;
try {
  const ads = require('react-native-google-mobile-ads');
  BannerAd = ads.BannerAd;
  BannerAdSize = ads.BannerAdSize;
  TestIds = ads.TestIds;
} catch (e) {
  console.warn('[AdBanner] react-native-google-mobile-ads 네이티브 모듈 미링크(재빌드 필요) — 배너 비활성화:', e);
}

// 2026-07-26 사용자 지시 — 평소(개발/테스트)엔 테스트 광고 ID를 쓰고, 실제 광고 ID는 출시 빌드에서만
// 켠다: 자기 폰에서 실 광고를 반복 로드/클릭하면 AdMob "invalid traffic"으로 계정이 정지될 수 있어서.
// 출시 때만 EXPO_PUBLIC_USE_REAL_ADS=true로 빌드 → 실 단위 ID. (앱 ID는 실제로 둬도 테스트 광고엔 무방.)
const USE_REAL_ADS = process.env.EXPO_PUBLIC_USE_REAL_ADS === 'true';
const REAL_BANNER_UNIT_ID = Platform.select({
  android: 'ca-app-pub-3201481146134957/1435065235',
  ios: 'ca-app-pub-3201481146134957/9222201702',
});
const BANNER_UNIT_ID = USE_REAL_ADS ? REAL_BANNER_UNIT_ID : TestIds?.ADAPTIVE_BANNER;
const adModuleAvailable = Boolean(BannerAd && BannerAdSize && BANNER_UNIT_ID);

export function AdBanner() {
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setHeight = useAdBannerStore((s) => s.setHeight);
  // 2026-08-03 — EEA/영국 GDPR: 동의를 받기 전에 광고를 "요청"하면 안 된다(SDK 초기화는 무방,
  // 로드가 문제다). 동의 흐름은 스플래시가 끝난 뒤 시작되므로 그때까지는 배너를 아예 안 붙인다.
  // EEA 밖에서는 동의가 불필요해 즉시 resolved=true가 되므로 한국 사용자 체감 지연은 사실상 없다
  // (store/useAdsConsentStore.ts, services/ads/adsConsent.ts 참고).
  const canRequestAds = useAdsConsentStore((s) => s.canRequestAds);
  const visible = adModuleAvailable && !failed && canRequestAds;

  // 2026-07-28 리서치(광고 2.4) — 예전엔 첫 로드 실패에 failed=true로 박아 세션 내내 배너가 영영 안 떴다
  // (일시적 no-fill 하나로 수익 0). 구글 권고대로 지수 백오프+지터로 재시도(5→10→20→40s 상한 60s) —
  // failed를 잠깐 true로 뒀다 타이머로 되돌리면 BannerAd가 remount되며 새로 로드한다. 성공 시 attempt 리셋.
  const handleFailed = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    const n = Math.min(attemptRef.current, 3); // 0,1,2,3 → 5,10,20,40s
    const base = 5000 * Math.pow(2, n);
    const delay = Math.min(60000, base) + Math.floor(base * 0.2 * ((attemptRef.current % 5) / 5)); // 결정론적 지터
    attemptRef.current += 1;
    setFailed(true);
    retryTimerRef.current = setTimeout(() => setFailed(false), delay);
  };
  useEffect(() => () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); }, []);

  // 2026-07-25 — 화면(Home/Focus/Stats/Settings)들이 이 배너의 실제 렌더 높이만큼 스크롤 하단
  // 여백을 잡아야 광고가 마지막 콘텐츠를 안 가린다(ANCHORED_ADAPTIVE_BANNER는 기기 너비에 따라
  // 높이가 달라 상수로 못 박음). 안 보일 때(네이티브 모듈 미링크/로드 실패/언마운트)는 0으로
  // 되돌려 화면이 여백을 도로 접게 한다. 훅 순서를 조건 안에서 바꾸면 안 되므로 항상 최상단에서
  // 호출하고, 내부에서만 visible로 분기한다.
  useEffect(() => {
    if (!visible) setHeight(0);
    return () => setHeight(0);
  }, [visible, setHeight]);

  if (!visible || !BannerAd || !BannerAdSize || !BANNER_UNIT_ID) return null;

  const handleLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <BannerAd
        unitId={BANNER_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        // 감사 H1(2026-07-27) — UMP 동의 플로우가 없어 EEA에서 개인화 광고는 정책 위반이 될 수 있다.
        // 비개인화로 요청해 동의 없이도 안전하게 서빙(앱의 NSPrivacyTracking=false/ATT 미사용 정합).
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => { attemptRef.current = 0; }}
        onAdFailedToLoad={handleFailed}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 4,
  },
});
