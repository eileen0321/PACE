import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
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

// 지금은 구글 공식 테스트 광고 단위 ID(TestIds.ADAPTIVE_BANNER)로 붙여뒀다 — 실제 배포 전에 AdMob
// 콘솔에서 발급받은 진짜 광고 단위 ID로 반드시 교체해야 한다(테스트 ID로 낸 채 배포하면 광고가
// 하나도 안 뜬다).
const adModuleAvailable = Boolean(BannerAd && BannerAdSize && TestIds);

export function AdBanner() {
  const [failed, setFailed] = useState(false);
  const [diag, setDiag] = useState('AD: loading…'); // 진단용 — 기기 광고 로드 상태를 화면에 표시
  const setHeight = useAdBannerStore((s) => s.setHeight);
  const visible = adModuleAvailable; // 진단 동안은 실패해도 컨테이너 유지(에러 텍스트 보이게)

  // 2026-07-25 — 화면(Home/Focus/Stats/Settings)들이 이 배너의 실제 렌더 높이만큼 스크롤 하단
  // 여백을 잡아야 광고가 마지막 콘텐츠를 안 가린다(ANCHORED_ADAPTIVE_BANNER는 기기 너비에 따라
  // 높이가 달라 상수로 못 박음). 안 보일 때(네이티브 모듈 미링크/로드 실패/언마운트)는 0으로
  // 되돌려 화면이 여백을 도로 접게 한다. 훅 순서를 조건 안에서 바꾸면 안 되므로 항상 최상단에서
  // 호출하고, 내부에서만 visible로 분기한다.
  useEffect(() => {
    if (!visible) setHeight(0);
    return () => setHeight(0);
  }, [visible, setHeight]);

  if (!visible || !BannerAd || !BannerAdSize || !TestIds) return null;

  const handleLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);
  void failed; void setFailed;

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <Text style={styles.diag}>{diag}</Text>
      <BannerAd
        unitId={TestIds.ADAPTIVE_BANNER}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdLoaded={() => setDiag('AD: loaded ✓')}
        onAdFailedToLoad={(e: unknown) => {
          const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : String(e);
          setDiag('AD FAIL: ' + msg);
        }}
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
  diag: { color: '#FFD400', fontSize: 11, paddingHorizontal: 8 },
});
