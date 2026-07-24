import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../constants/theme';

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

// 지금은 구글 공식 테스트 광고 단위 ID(TestIds.ADAPTIVE_BANNER)로 붙여뒀다 — 실제 배포 전에 AdMob
// 콘솔에서 발급받은 진짜 광고 단위 ID로 반드시 교체해야 한다(테스트 ID로 낸 채 배포하면 광고가
// 하나도 안 뜬다).
export function AdBanner() {
  const [failed, setFailed] = useState(false);
  if (!BannerAd || !BannerAdSize || !TestIds || failed) return null;
  return (
    <View style={styles.container}>
      <BannerAd
        unitId={TestIds.ADAPTIVE_BANNER}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailed(true)}
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
