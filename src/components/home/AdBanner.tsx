import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { colors } from '../../constants/theme';
import { useAdBannerStore } from '../../store/useAdBannerStore';

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

// 2026-07-26 — AdMob 앱 승인 완료, 실제 배너 광고 단위 ID로 교체(테스트ID였던 TestIds.ADAPTIVE_BANNER
// 대신). 새 광고 단위는 활성화까지 최대 1시간 걸릴 수 있어 그 사이엔 onAdFailedToLoad로 조용히 숨김.
const BANNER_UNIT_ID = Platform.select({
  android: 'ca-app-pub-3201481146134957/1435065235',
  ios: 'ca-app-pub-3201481146134957/9222201702',
  default: TestIds?.ADAPTIVE_BANNER,
});
const adModuleAvailable = Boolean(BannerAd && BannerAdSize && BANNER_UNIT_ID);

export function AdBanner() {
  const [failed, setFailed] = useState(false);
  const setHeight = useAdBannerStore((s) => s.setHeight);
  const visible = adModuleAvailable && !failed;

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
