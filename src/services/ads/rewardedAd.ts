import { Platform } from 'react-native';
import { ensureAdsConsent } from './adsConsent';
import { USE_REAL_ADS } from './adsConfig';
import { useAdsConsentStore } from '../../store/useAdsConsentStore';

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

// 2026-07-26 사용자 지시 — 평소엔 테스트 광고, 실 ID는 출시 빌드만. 자기 폰에서 실 광고 반복
// 시청은 AdMob invalid traffic(계정 정지) 위험.
// 🔴 2026-08-11 사장님 지시("git 가져와서 매출관련 전체 전수확인해") 감사 발견 — 이 스위치가
// `EXPO_PUBLIC_USE_REAL_ADS` 환경변수 하나에 의존했는데, 이 값은 `eas.json`의 production 프로필
// 에만 있고 이 세션 내내 써온 로컬 빌드 파이프라인(`expo run:ios --configuration Release`,
// `xcodebuild archive`)은 eas.json을 아예 읽지 않는다 — `.env`에도 이 키가 없다(확인: `.env` grep
// 0건, 현재 셸 env도 비어 있음). 즉 **오늘 밤 실기기에 깐 모든 Release 빌드(App Store 제출분
// 포함 가능성 있음)가 테스트 광고를 내보내고 있었다** — 광고는 화면에 정상적으로 뜨니(그래서
// "광고가 안 뜬다"는 신고로는 안 걸림) 아무도 눈치채지 못한 채 보상형 광고 수익이 전부 0이었다.
// AdBanner.tsx도 완전히 같은 패턴으로 같은 구멍이 있었다(둘 다 수정).
// → 외부 env 파일 플러밍에 기대는 대신, 이 코드베이스가 이미 검증된 방식(adsConfig.ts의
// `!__DEV__` 판정 — Metro가 Release JS 번들에 굽는 값이라 어떤 빌드 경로든 항상 정확하다)으로
// 통일한다. `EXPO_PUBLIC_AD_TEST_DEVICES`(adsConfig.ts와 동일 플래그, 재사용)로 Release 빌드에서도
// 안전하게 테스트 광고로 되돌릴 수 있는 탈출구는 유지.
// 🔴 2026-08-11(2차) — 판정을 adsConfig.ts 한 곳으로 모았다. 여기/AdBanner/_layout 세 곳에 같은
// 식이 복붙돼 있어 한쪽만 고쳐지면 조용히 갈라진다(바로 위 감사가 세 파일을 동시에 고쳐야 했던
// 이유이고, 오늘 Focus Session 타이머에서도 같은 종류의 사고를 하루 종일 겪었다).
// ⚠️ `!__DEV__`만으로는 **트랙 구분이 안 된다** — Android 비공개 테스트와 iOS 프로덕션이 둘 다
//   릴리즈인데 요구가 정반대다(전자는 테스트 광고, 후자는 실광고). adsConfig의 USE_REAL_ADS가
//   플랫폼별 출시 상태까지 반영한다. 상세 근거는 그 상수 주석 참고.
// 2026-07-28 사장님 확인 — 보상형 실 ID가 iOS/Android 구분 없이 하나(5534238136=Android)만 박혀 있어
// iOS에선 잘못된 단위였다. AdMob 콘솔에서 iOS 보상형 단위 = BonusCredit(6596038364) 확인 → 배너처럼 분리.
const REAL_REWARDED_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-3201481146134957/6596038364',     // iOS: BonusCredit (보상형)
  android: 'ca-app-pub-3201481146134957/5534238136', // Android: 기존 보상형 단위
  default: 'ca-app-pub-3201481146134957/5534238136',
}) as string;
function getAdUnitId(): string {
  if (USE_REAL_ADS) return REAL_REWARDED_UNIT_ID;
  return TestIds?.REWARDED ?? 'ca-app-pub-3940256099942544/5224354917'; // 구글 공식 테스트 리워드 유닛
}

export const rewardedAdAvailable = Boolean(RewardedAd && RewardedAdEventType && AdEventType && TestIds);

// 2026-08-02 사장님 지시("원인 구분 못 하는 곳 전수 확인") — 예전엔 실패 원인 세 가지(모듈 미링크 /
// 로드 타임아웃=재고없음·네트워크 / SDK 에러)가 전부 'failed' 하나로 뭉개져서, 호출부가 사용자에게
// 무엇을 안내해야 할지(네트워크 확인하라고 할지, 그냥 다시 눌러보라고 할지) 판단할 근거가 없었다.
// 무료 사용자가 시간을 연장하려는 순간이라 이탈 지점이기도 해서 원인별 안내가 필요하다.
// 기존 호출부 호환을 위해 'failed'는 유니온에 남겨두지 않고, 대신 아래 isAdFailure()로 판별한다.
export type RewardedAdResult =
  | 'earned'
  | 'closed_without_reward'
  | 'failed_unavailable' // 광고 모듈 자체가 없음(네이티브 미링크) — 재시도해도 소용없음
  | 'failed_no_fill'     // 20초 안에 아무 이벤트 없음 — 재고 없음/네트워크 지연, 잠시 후 재시도 권장
  | 'failed_error';      // SDK가 명시적으로 에러 반환 — 재시도 가능

const AD_FAILURES: RewardedAdResult[] = ['failed_unavailable', 'failed_no_fill', 'failed_error'];

/** 결과가 실패 계열인지 — 호출부가 원인별로 분기하지 않고 뭉뚱그려 처리할 때 사용. */
export function isAdFailure(result: RewardedAdResult): boolean {
  return AD_FAILURES.includes(result);
}

// 매 호출마다 새 인스턴스를 만든다 — RewardedAd는 1회성(보여준 뒤 재사용 불가)이라, 세션 중 여러 번
// 한도에 도달하면(연속으로 광고를 봐서 계속 이어가는 경우) 그때마다 새로 로드해야 한다.
export async function showRewardedAd(): Promise<RewardedAdResult> {
  if (!rewardedAdAvailable) return 'failed_unavailable';

  // 2026-08-03 — EEA/영국 GDPR: 광고를 "요청"하기 전에 동의가 끝나 있어야 한다. 아래 요청은
  // requestNonPersonalizedAdsOnly로 나가지만 **비개인화 광고도 면제 대상이 아니다** — 구글은
  // 2024-01-16부터 EEA/영국 사용자에게 광고를 서빙하려면 개인화 여부와 무관하게 인증 CMP를 통한
  // 동의를 요구한다. 아래 코드의 옛 주석("EEA UMP 동의 요건 회피")은 그 점에서 틀린 전제였다.
  // 실제로는 스플래시 직후 동의 흐름이 이미 끝나 있어(_layout.tsx) 이 대기는 즉시 통과하지만,
  // 사용자가 아주 빠르게 광고 버튼에 도달한 경우를 대비해 여기서도 한 번 보장한다.
  if (!useAdsConsentStore.getState().canRequestAds) {
    const result = await ensureAdsConsent();
    useAdsConsentStore.getState().setConsent(result);
    // 동의를 못 받았으면(EEA에서 사용자가 거부했거나 폼 로딩 실패) 광고를 요청하지 않는다 —
    // 요청해봐야 no-fill로 돌아오고, 무엇보다 동의 없이 요청하는 것 자체가 정책 위반이다.
    if (!result.canRequestAds) return 'failed_unavailable';
  }

  return new Promise((resolve) => {
    let settled = false;
    let earned = false;
    // 2026-08-04 사장님 지시("광고 전수 확인") 발견 — 아래 타이머는 "로드 대기"를 끊으려고 넣은
    // 것인데 LOADED에서 꺼주지 않아 **광고가 화면에 떠 있는 동안** 20초째에 그대로 터졌다.
    // 보상형 광고는 보통 15~30초라 상당수가 여기 걸렸고, 그때마다:
    //   - 프라미스가 failed_no_fill로 resolve → 광고 위에 "광고 실패" 토스트가 뜨고
    //   - 아래 unsubscribers가 전부 해제 → EARNED_REWARD/CLOSED가 죽어서
    //   → **끝까지 다 보고도 5분이 안 들어갔다.**
    // 타이머를 단계별로 다시 건다: 로드까지는 짧게(LOAD), 광고가 뜬 뒤에는 "혹시 CLOSED가 영영
    // 안 와서 모달 스피너가 무한 대기하는" 경우만 막는 넉넉한 감시견(SHOW)으로 교체한다.
    const LOAD_TIMEOUT_MS = 20000;
    const SHOW_WATCHDOG_MS = 5 * 60 * 1000; // 어떤 보상형 광고도 5분을 넘지 않는다
    // 2026-08-04 — 사용자가 실제로 준 동의를 따른다(services/ads/adsConsent.ts의
    // canRequestPersonalizedAds 주석 참고). 예전엔 비개인화가 하드코딩돼 있어, 개인화에 동의한
    // 사용자에게도 계속 비개인화 광고만 나가며 수익이 깎이고 있었다.
    // 2026-08-05 §4-2(MAC_HANDOFF) — canRequestPersonalizedAds는 UMP(GDPR) 동의일 뿐 애플 ATT 동의가
    // 아니다. 이 앱은 ATTrackingManager 프롬프트를 안 띄우므로 iOS에서 IDFA 기반 개인화 광고를
    // 요청하면 트래킹 동의 없이 추적하는 셈이라 애플 정책 위반이다 — iOS는 항상 비개인화만 요청한다.
    const rewarded = RewardedAd!.createForAdRequest(getAdUnitId(), {
      requestNonPersonalizedAdsOnly: Platform.OS === 'ios' ? true : !useAdsConsentStore.getState().canRequestPersonalizedAds,
    });
    const unsubscribers: Array<() => void> = [];
    let timeoutId: ReturnType<typeof setTimeout>;
    const finish = (result: RewardedAdResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      unsubscribers.forEach((u) => u());
      resolve(result);
    };
    // 로드 타임아웃 — 노필(no-fill) 등으로 LOADED/ERROR가 끝내 안 오면 프라미스가 영영 안 풀려
    // 모달의 "광고 보는 중" 스피너가 무한 대기한다(감사 발견). 20초 안에 아무 이벤트도 없으면 실패 처리.
    timeoutId = setTimeout(() => finish('failed_no_fill'), LOAD_TIMEOUT_MS);

    unsubscribers.push(
      rewarded.addAdEventListener(RewardedAdEventType!.LOADED, () => {
        // 로드는 끝났다 — 여기서 로드 타임아웃을 반드시 꺼야 한다(위 주석 참고). 이 시점부터는
        // 사용자가 광고를 보는 시간이라 남은 시간에 제한을 두면 안 된다.
        clearTimeout(timeoutId);
        // 감시견이 끝내 터지더라도 이미 보상을 받았으면 보상으로 확정한다 — 사용자가 광고를 다 본
        // 것은 EARNED_REWARD로 확정된 사실이고, CLOSED가 안 온 건 우리 사정이지 사용자 잘못이 아니다.
        timeoutId = setTimeout(() => finish(earned ? 'earned' : 'failed_error'), SHOW_WATCHDOG_MS);
        rewarded.show().catch(() => finish('failed_error'));
      })
    );
    unsubscribers.push(
      rewarded.addAdEventListener(RewardedAdEventType!.EARNED_REWARD, () => {
        earned = true;
      })
    );
    unsubscribers.push(
      rewarded.addAdEventListener(AdEventType!.ERROR, () => finish('failed_error'))
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
