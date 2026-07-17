import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
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
  await AsyncStorage.setItem(STORAGE_KEYS.premiumIsPremium, isPremium ? '1' : '0');
  set({ isPremium });

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
  currentUserId: null,

  init: async () => {
    if (!RC_KEY) {
      const cached = await AsyncStorage.getItem(STORAGE_KEYS.premiumIsPremium);
      set({ isPremium: cached === '1', isReady: true });
      return;
    }
    try {
      Purchases.configure({ apiKey: RC_KEY });
      const info = await Purchases.getCustomerInfo();
      await applyCustomerInfo(info, set, get);
      const offerings = await Purchases.getOfferings();
      set({ offerings: offerings.current?.availablePackages ?? [] });
      Purchases.addCustomerInfoUpdateListener((ci) => { applyCustomerInfo(ci, set, get).catch(() => {}); });
    } catch {
      const cached = await AsyncStorage.getItem(STORAGE_KEYS.premiumIsPremium);
      set({ isPremium: cached === '1' });
    } finally {
      set({ isReady: true });
    }
  },

  purchase: async (pkg) => {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    await applyCustomerInfo(customerInfo, set, get);
  },

  restore: async () => {
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
    const { customerInfo } = await Purchases.logIn(userId);
    await applyCustomerInfo(customerInfo, set, get);
  },

  reset: async () => {
    set({ currentUserId: null, isReviewer: false });
    if (!RC_KEY) return;
    const info = await Purchases.logOut();
    await applyCustomerInfo(info, set, get);
  },
}));
