import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { STORAGE_KEYS } from '../services/storage/keys';
import { saveEntitlement, clearEntitlement } from '../database/repositories/subscriptionRepository';

// zen-master PremiumContext.tsx의 핵심 사상만 이식: entitlement 기반 isPremium 판정 +
// 로컬 만료시각 캐시(오프라인 방어) + CustomerInfo 리스너로 실시간 갱신. Context Provider 대신
// init()을 앱 부팅 시 1회 호출하는 Zustand 패턴으로 변경.
// RC(RevenueCat)가 단일 진실원천이라는 jlpt-master 계약(PACE_ARCHITECTURE.md "외부 리뷰 반영 3차")을
// 그대로 따른다 — 이 스토어의 isPremium은 오직 CustomerInfo로만 갱신된다.
const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? '';
const RC_IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY ?? '';
const RC_KEY = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;

type SubscriptionState = {
  isPremium: boolean;
  offerings: PurchasesPackage[];
  isReady: boolean;
  /** SQLite 미러링 대상 유저 id — useUserStore를 직접 import하면 순환참조가 생겨(실기기 빌드에서
   *  Metro WARN로 확인됨) identify()/reset() 호출 시점에 로컬로만 기억해 둔다. */
  currentUserId: string | null;
  init: () => Promise<void>;
  purchase: (pkg: PurchasesPackage) => Promise<void>;
  restore: () => Promise<void>;
  identify: (userId: string) => Promise<void>;
  reset: () => Promise<void>;
};

async function applyCustomerInfo(info: CustomerInfo, set: (v: Partial<SubscriptionState>) => void, get: () => SubscriptionState) {
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
    if (!RC_KEY) return;
    const { customerInfo } = await Purchases.logIn(userId);
    await applyCustomerInfo(customerInfo, set, get);
  },

  reset: async () => {
    set({ currentUserId: null });
    if (!RC_KEY) return;
    const info = await Purchases.logOut();
    await applyCustomerInfo(info, set, get);
  },
}));
