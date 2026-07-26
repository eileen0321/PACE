import { Platform } from 'react-native';

// 2026-07-26 사용자 지시 — 무료 사용자의 Focus Session 자동넘김이 한도(기본 30회)에 도달하면
// 보상형 광고를 보여주고, 시청 완료 시 20회를 더 준다. AdBanner.tsx와 동일한 방어적 require
// 패턴 — 네이티브 재빌드 전(모듈 미링크)에도 앱이 죽지 않게 한다.
let RewardedAd: typeof import('react-native-google-mobile-ads').RewardedAd | null = null;
let RewardedAdEventType: typeof import('react-native-google-mobile-ads').RewardedAdEventType | null = null;
let AdEventType: typeof import('react-native-google-mobile-ads').AdEventType | null = null;
let TestIds: typeof import('react-native-google-mobile-ads').TestIds | null = null;
try {
  const ads = require('react-native-google-mobile-ads');
  RewardedAd = ads.RewardedAd;
  RewardedAdEventType = ads.RewardedAdEventType;
  AdEventType = ads.AdEventType;
  TestIds = ads.TestIds;
} catch (e) {
  console.warn('[rewardedAd] react-native-google-mobile-ads 네이티브 모듈 미링크(재빌드 필요) — 보상형 광고 비활성화:', e);
}

// 2026-07-26 사용자 지시 — 평소엔 테스트 광고, 실 ID는 출시 빌드(EXPO_PUBLIC_USE_REAL_ADS=true)만.
// 자기 폰에서 실 광고 반복 시청은 AdMob invalid traffic(계정 정지) 위험. (Android 전용 기능.)
const USE_REAL_ADS = process.env.EXPO_PUBLIC_USE_REAL_ADS === 'true';
function getAdUnitId(): string {
  if (USE_REAL_ADS) return 'ca-app-pub-3201481146134957/5534238136';
  return TestIds?.REWARDED ?? 'ca-app-pub-3940256099942544/5224354917'; // 구글 공식 테스트 리워드 유닛
}

export const rewardedAdAvailable = Boolean(RewardedAd && RewardedAdEventType && AdEventType && TestIds);

export type RewardedAdResult = 'earned' | 'closed_without_reward' | 'failed';

// 매 호출마다 새 인스턴스를 만든다 — RewardedAd는 1회성(보여준 뒤 재사용 불가)이라, 세션 중 여러 번
// 한도에 도달하면(연속으로 광고를 봐서 계속 이어가는 경우) 그때마다 새로 로드해야 한다.
export function showRewardedAd(): Promise<RewardedAdResult> {
  if (!rewardedAdAvailable) return Promise.resolve('failed');

  return new Promise((resolve) => {
    let settled = false;
    let earned = false;
    // 감사 H1 — 배너와 동일하게 비개인화 광고로 요청(EEA UMP 동의 요건 회피, no-ATT 정합).
    const rewarded = RewardedAd!.createForAdRequest(getAdUnitId(), { requestNonPersonalizedAdsOnly: true });
    const unsubscribers: Array<() => void> = [];
    const finish = (result: RewardedAdResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      unsubscribers.forEach((u) => u());
      resolve(result);
    };
    // 로드 타임아웃 — 노필(no-fill) 등으로 LOADED/ERROR가 끝내 안 오면 프라미스가 영영 안 풀려
    // 모달의 "광고 보는 중" 스피너가 무한 대기한다(감사 발견). 20초 안에 아무 이벤트도 없으면 실패 처리.
    const timeoutId = setTimeout(() => finish('failed'), 20000);

    unsubscribers.push(
      rewarded.addAdEventListener(RewardedAdEventType!.LOADED, () => {
        rewarded.show().catch(() => finish('failed'));
      })
    );
    unsubscribers.push(
      rewarded.addAdEventListener(RewardedAdEventType!.EARNED_REWARD, () => {
        earned = true;
      })
    );
    unsubscribers.push(
      rewarded.addAdEventListener(AdEventType!.ERROR, () => finish('failed'))
    );
    unsubscribers.push(
      rewarded.addAdEventListener(AdEventType!.CLOSED, () => finish(earned ? 'earned' : 'closed_without_reward'))
    );

    rewarded.load();
  });
}

// iOS는 자동넘김 한도 개념 자체가 없어(Android 전용 기능) 이 서비스를 부를 일이 없지만, 실수로
// 불려도 안전하게 실패 처리.
export function isRewardedAdSupportedPlatform(): boolean {
  return Platform.OS === 'android';
}
