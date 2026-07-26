import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { STORAGE_KEYS } from '../services/storage/keys';
import { saveEntitlement, clearEntitlement } from '../database/repositories/subscriptionRepository';
import { isReviewerEmail } from '../constants/reviewers';

// zen-master/jlpt-master PremiumContext.tsx의 핵심 사상 이식: entitlement 기반 isPremium 판정 +
// 로컬 만료시각 캐시(오프라인 방어) + CustomerInfo 리스너로 실시간 갱신 + 스토어 심사관 화이트리스트
// 바이패스. Context Provider 대신 init()을 앱 부팅 시 1회 호출하는 Zustand 패턴으로 변경.
// RC(RevenueCat)가 단일 진실원천이라는 jlpt-master 계약(PACE_ARCHITECTURE.md "외부 리뷰 반영 3차")을
// 그대로 따른다 — 이 스토어의 isPremium은 오직 CustomerInfo(또는 심사관 바이패스)로만 갱신된다.
const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? '';
const RC_IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY ?? '';
const RC_KEY = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;

type SubscriptionState = {
  isPremium: boolean;
  isReviewer: boolean;
  offerings: PurchasesPackage[];
  isReady: boolean;
  /** init()의 RC 호출(getCustomerInfo/getOfferings)이 실패했는지 — 폴백 캐시로 조용히 넘어가는 대신
   *  paywall 화면이 "불러오기 실패, 재시도" UI를 보여줄 수 있게 노출한다(2026-07-21 감사 발견). */
  initError: boolean;
  /** SQLite 미러링 대상 유저 id — useUserStore를 직접 import하면 순환참조가 생겨(실기기 빌드에서
   *  Metro WARN로 확인됨) identify()/reset() 호출 시점에 로컬로만 기억해 둔다. */
  currentUserId: string | null;
  init: () => Promise<void>;
  purchase: (pkg: PurchasesPackage) => Promise<void>;
  restore: () => Promise<void>;
  /** userId는 jlpt-master 계약상 이메일이다(app_user_id=email) — 심사관 화이트리스트 판정에도 이 값을 쓴다. */
  identify: (userId: string) => Promise<void>;
  reset: () => Promise<void>;
};

async function applyCustomerInfo(info: CustomerInfo, set: (v: Partial<SubscriptionState>) => void, get: () => SubscriptionState) {
  // jlpt-master PremiumContext.tsx와 동일 원칙: 심사관으로 확정된 세션은 RC 응답(entitlement 없음 등)이
  // 나중에 도착해도 덮어쓰지 않는다 — 심사관이 실제로 프리미엄 UX를 검증할 수 있어야 하기 때문.
  if (get().isReviewer) return;

  const active = info.entitlements.active ?? {};
  const isPremium = Object.keys(active).length > 0;
  // 2026-07-21 감사 발견: AsyncStorage.setItem을 set() 이전에 await 했었다 — 결제가 실제로 성공해서
  // RC가 이미 entitlement를 준 뒤에도, 로컬 캐시 쓰기(드묾: 저장공간 이슈 등)가 실패하면 전체 함수가
  // reject돼 메모리상 isPremium이 영영 true로 안 바뀌는 "돈은 냈는데 잠금 안 풀림" 버그였다. 진짜
  // 상태(set)를 먼저 반영하고, 로컬 캐시 쓰기는 실패해도 무해하게(다음 성공 시 다시 씀) 별도 처리.
  set({ isPremium });
  AsyncStorage.setItem(STORAGE_KEYS.premiumIsPremium, isPremium ? '1' : '0').catch(() => {});

  const userId = get().currentUserId;
  if (!userId) return;
  if (isPremium) {
    const expiresAt = Object.values(active)[0]?.expirationDate ?? null;
    saveEntitlement(userId, { plan: 'premium_monthly', status: 'active', expiresAt }).catch(() => {});
  } else {
    clearEntitlement(userId).catch(() => {});
  }
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  isPremium: false,
  isReviewer: false,
  offerings: [],
  isReady: false,
  initError: false,
  currentUserId: null,

  init: async () => {
    if (!RC_KEY) {
      const cached = await AsyncStorage.getItem(STORAGE_KEYS.premiumIsPremium);
      set({ isPremium: cached === '1', isReady: true });
      return;
    }
    // 2026-07-27 감사 발견(subscription B1) — RC_KEY가 있으면 곧장 네트워크 getCustomerInfo로 갔는데,
    // 그게 resolve되기 전까지 isPremium이 스토어 기본값 false라 유료 사용자가 콜드런치 직후 잠깐
    // 광고배너((tabs)/_layout)와 프리미엄 게이트(→페이월)에 노출됐다(느린 망일수록 길어짐). 캐시로 먼저
    // 낙관적 seed하고, 바로 아래 getCustomerInfo + addCustomerInfoUpdateListener가 RC 실제값으로 정정한다
    // (만료됐으면 applyCustomerInfo가 false로 내림 — 잠깐의 과다부여는 광고 오노출보다 안전한 트레이드오프).
    const cachedPremium = await AsyncStorage.getItem(STORAGE_KEYS.premiumIsPremium);
    if (cachedPremium === '1') set({ isPremium: true });
    // 2026-07-26 감사 발견 — getCustomerInfo(entitlement 판정, 보안적으로 중요)와 getOfferings
    // (구매 가능 상품 목록, 표시용일 뿐)를 하나의 try/catch로 묶어뒀었다. getCustomerInfo가 실제
    // 유료 구독자의 isPremium=true를 이미 확정한 뒤에, 그 다음 줄 getOfferings()만 네트워크
    // 문제 등으로 실패해도 catch 블록이 캐시값으로 isPremium을 다시 덮어써서(캐시가 아직 안
    // 갱신됐거나 구독 이전 값이면) 유료 사용자가 그 세션 내내 무료로 강등되는 버그였다 — 게다가
    // addCustomerInfoUpdateListener도 offerings 성공 이후에만 등록돼서 이후 어떤 RC 업데이트로도
    // 스스로 복구되지 않았다. 두 호출을 독립된 try/catch로 분리 — offerings 실패는 절대
    // isPremium을 건드리지 않는다.
    try {
      // 2026-07-26 밤 실기기 발견 — 디버그 빌드는 RC 기본 로그 레벨이 DEBUG라(공식 문서: "release는
      // INFO, debug는 DEBUG가 기본"), 지금 RC 대시보드에 offering이 없어 매번 실패하는 "Error
      // fetching offerings" 경고가 SDK 내부적으로 반복 로깅되며 Metro의 WebSocket 개발자도구 로그
      // 채널로 그대로 쏟아졌다 — 그 물량이 `ws` 라이브러리의 프레임 버퍼 한도를 넘겨
      // `WS_ERR_TOO_MANY_BUFFERED_PARTS`로 Metro Node 프로세스 자체가 죽는 사고로 이어졌다(오늘
      // 하루 종일 반복된 "앱이 스플래시에서 멈춤"의 진짜 원인 — 앱이 아니라 Metro가 죽어있었음).
      // ERROR만 남겨(그마저도 실제 실패 시 1회성이라 빈도 낮음, 반복되던 건 WARN 레벨의 "Billing
      // Service disconnected" 재연결 시도 로그였음) 이 스팸을 원천 차단 — configure() 전에 호출해야
      // 적용된다.
      Purchases.setLogLevel(LOG_LEVEL.ERROR);
      Purchases.configure({ apiKey: RC_KEY });
      const info = await Purchases.getCustomerInfo();
      await applyCustomerInfo(info, set, get);
      Purchases.addCustomerInfoUpdateListener((ci) => { applyCustomerInfo(ci, set, get).catch(() => {}); });
    } catch (e) {
      // 2026-07-21 감사 발견: 여기가 원래 빈 catch{}라 진단이 아예 불가능했고, paywall 화면은
      // "불러오는 중"만 무한히 보여줬다(기존 QA #6). 최소한 로그는 남기고, initError를 노출해
      // paywall이 재시도 UI를 보여줄 수 있게 한다.
      console.warn('[useSubscriptionStore] init (getCustomerInfo) failed', e);
      const cached = await AsyncStorage.getItem(STORAGE_KEYS.premiumIsPremium);
      set({ isPremium: cached === '1', initError: true });
    }
    try {
      const offerings = await Purchases.getOfferings();
      set({ offerings: offerings.current?.availablePackages ?? [] });
    } catch (e) {
      console.warn('[useSubscriptionStore] init (getOfferings) failed', e);
      set({ initError: true });
    } finally {
      set({ isReady: true });
    }
  },

  purchase: async (pkg) => {
    if (!RC_KEY) throw new Error('RC_NOT_CONFIGURED'); // restore()와 동일 가드 — RC 미설정 시 미구성 SDK 호출 방지
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    await applyCustomerInfo(customerInfo, set, get);
  },

  restore: async () => {
    if (!RC_KEY) throw new Error('RC_NOT_CONFIGURED');
    const info = await Purchases.restorePurchases();
    await applyCustomerInfo(info, set, get);
  },

  identify: async (userId) => {
    set({ currentUserId: userId });
    // 스토어 심사관 화이트리스트(constants/reviewers.ts) — RC 응답과 무관하게 즉시 프리미엄 부여.
    // jlpt-master의 "히든 리뷰어 링크 없이 소셜 로그인 이메일만으로 판정" 방식을 그대로 따른다.
    if (isReviewerEmail(userId)) {
      set({ isReviewer: true, isPremium: true });
      await AsyncStorage.setItem(STORAGE_KEYS.premiumIsPremium, '1');
    } else {
      set({ isReviewer: false });
    }
    if (!RC_KEY) return;
    try {
      const { customerInfo } = await Purchases.logIn(userId);
      await applyCustomerInfo(customerInfo, set, get);
    } catch (e) {
      // 2026-07-21 감사 발견: 실패해도(오프라인 로그인 등) 계정이 RC의 진짜 app_user_id에 안 묶인
      // 채로 조용히 넘어갔다 — 최소한 로그는 남겨서 진단 가능하게 한다(호출부도 이미 .catch로
      // 감싸고 있어 여기서 다시 던지지는 않음, 로그인 자체를 막을 정도의 오류는 아니라서).
      console.warn('[useSubscriptionStore] identify (RC logIn) failed', e);
    }
  },

  reset: async () => {
    // 2026-07-21 감사 발견(가장 심각): 여기 try/catch가 아예 없었다 — Purchases.logOut()이
    // 실패하면(오프라인 로그아웃 등 흔한 케이스) applyCustomerInfo가 전혀 안 돌아서 메모리상
    // isPremium이 로그아웃 전 값(예: true)에 그대로 남았고, 바로 다음 줄에서 만들어지는 새
        // 게스트/계정 세션이 그 stale한 프리미엄 상태를 그대로 물려받는 "잘못된 접근 허용" 버그였다.
    // 로그아웃/리셋의 안전한 기본값은 항상 "프리미엄 아님"이므로, RC 응답을 못 받아도 명시적으로
    // false로 초기화한다 — RC가 나중에 다시 성공하면(다음 identify 등) 그때 진짜 값으로 갱신됨.
    set({ currentUserId: null, isReviewer: false, isPremium: false });
    AsyncStorage.setItem(STORAGE_KEYS.premiumIsPremium, '0').catch(() => {});
    if (!RC_KEY) return;
    try {
      const info = await Purchases.logOut();
      await applyCustomerInfo(info, set, get);
    } catch (e) {
      console.warn('[useSubscriptionStore] reset (RC logOut) failed — isPremium already cleared to false', e);
    }
  },
}));
