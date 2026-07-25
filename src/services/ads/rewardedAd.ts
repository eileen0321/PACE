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

// AdBanner.tsx와 동일한 이유로 지금은 테스트 광고 단위 ID — 배포 전 AdMob 콘솔에서 발급받은 진짜
// 보상형 광고 단위 ID로 교체 필요(테스트 ID로 배포하면 실제 보상형 광고가 하나도 안 뜬다).
function getAdUnitId(): string {
  return TestIds!.REWARDED;
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
    const rewarded = RewardedAd!.createForAdRequest(getAdUnitId());
    const unsubscribers: Array<() => void> = [];
    const finish = (result: RewardedAdResult) => {
      if (settled) return;
      settled = true;
      unsubscribers.forEach((u) => u());
      resolve(result);
    };

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
