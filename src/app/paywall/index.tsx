import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, Text, View, Pressable, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useUserStore } from '../../store/useUserStore';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { TERMS_OF_USE_URL, PRIVACY_POLICY_URL } from '../../constants/legal';

// 구독 기간(RevenueCat packageType) → 표시 라벨/가격 기간 접미사. ASC "표시 이름"이 월/연 동일해도
// 앱에서 "연간/월간"으로 확실히 구분된다(2026-07-30 사장님 지적 대응).
const PLAN_LABEL_KEY: Record<string, TranslationKey> = {
  ANNUAL: 'paywall.planYearly',
  MONTHLY: 'paywall.planMonthly',
  WEEKLY: 'paywall.planWeekly',
  LIFETIME: 'paywall.planLifetime',
};
const PRICE_PERIOD_KEY: Record<string, TranslationKey> = {
  ANNUAL: 'paywall.pricePerYear',
  MONTHLY: 'paywall.pricePerMonth',
  WEEKLY: 'paywall.pricePerWeek',
};

// jlpt-master PremiumPaywallModal.tsx의 로직(로그인 필수 가드, 구매/복원 흐름)만 이식하고 비주얼
// 처리는 이식하지 않는다 — 그라디언트/블러/컨페티는 기획서 "디자인 원칙"(No Gradients/No
// Glassmorphism)과 직접 배치되므로 Pace 자체 플랫 디자인을 유지한다.
// 게스트/비로그인 상태로 결제하면 RC가 익명 ID로 구매를 잡아 이후 이메일과 영영 매칭이 안 되는
// 사고(jlpt-master가 2026-07-17 실결제 사고로 확인)가 날 수 있어 로그인부터 강제한다.
export default function PaywallScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const { offerings, purchase, restore, init, initError, isReady } = useSubscriptionStore();
  // 2026-07-26 감사 발견 — purchase/restore 버튼 둘 다 진행 중 상태 가드가 없어서, 응답이 오기 전
  // 빠르게 두 번 탭하면 Purchases.purchasePackage()/restorePurchases()가 동시에 두 번 나갈 수
  // 있었다(이중 결제 위험). 하나의 플래그로 두 액션을 함께 막는다 — 동시에 둘 다 누를 이유가
  // 없으므로 굳이 따로 안 나눔.
  const [purchasing, setPurchasing] = useState(false);
  // 2026-07-27 — jlpt-master의 reloadWithBackoff 이식: 스토어 연결 실패가 진짜 오프라인이 아니라
  // 순간적인 네트워크 흔들림인 경우가 많아, "다시 시도" 버튼 한 번에 즉시 재요청 하나만 쏘는 대신
  // 짧은 지수 백오프(1s/2s/4s)로 최대 3번 시도한다 — 마지막 시도까지 실패해야만 사용자가 다시
  // 버튼을 눌러야 하는 상태로 남는다.
  const [retrying, setRetrying] = useState(false);
  const retryWithBackoff = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await init();
        if (!useSubscriptionStore.getState().initError) break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    } finally {
      setRetrying(false);
    }
  };

  const blockIfNotSignedIn = (): boolean => {
    const notSignedIn = !user || user.isGuest || !user.email;
    if (notSignedIn) {
      Alert.alert(t('auth.title'), t('paywall.signInRequiredMessage'), [
        { text: t('settings.cancel'), style: 'cancel' },
        { text: t('auth.title'), onPress: () => { router.back(); router.push('/auth'); } },
      ]);
    }
    return notSignedIn;
  };

  // 2026-07-21 감사 발견 3건 반영:
  // (1) 구매 취소(userCancelled)는 실패가 아니므로 에러 알림을 안 띄운다 — 사용자가 그냥 마음을
  //     바꾼 것뿐인데 무서운 에러 팝업이 뜨는 건 잘못된 피드백이었다.
  // (2) 실제 실패/성공 둘 다 이전엔 피드백이 전혀 없었다(성공 시 아무 반응 없음) — 번역 키 추가해서
  //     명확히 알려준다.
  const onPurchase = (pkg: (typeof offerings)[number]) => {
    if (purchasing) return;
    if (blockIfNotSignedIn()) return;
    setPurchasing(true);
    purchase(pkg)
      .then(() => Alert.alert(t('paywall.purchaseSuccessTitle'), t('paywall.purchaseSuccessMessage')))
      .catch((e: { userCancelled?: boolean | null; message?: string } | undefined) => {
        if (e?.userCancelled) return;
        Alert.alert(t('paywall.title'), e?.message ?? String(e));
      })
      .finally(() => setPurchasing(false));
  };

  const onRestore = () => {
    if (purchasing) return;
    if (blockIfNotSignedIn()) return;
    setPurchasing(true);
    restore()
      .then(() => {
        const hasPremiumNow = useSubscriptionStore.getState().isPremium;
        Alert.alert(
          t('paywall.restoreSuccessTitle'),
          hasPremiumNow ? t('paywall.restoreSuccessMessage') : t('paywall.restoreNothingFound')
        );
      })
      .catch((e: { message?: string } | undefined) => {
        // 2026-07-21 감사 발견: RC_KEY 미설정 시 restore()가 이제 명시적으로 RC_NOT_CONFIGURED를
        // 던진다 — 예전엔 여기까지 와서 완전히 조용히 사라졌다(버튼 눌러도 아무 반응 없음).
        const msg = e?.message === 'RC_NOT_CONFIGURED' ? t('paywall.notConfigured') : t('paywall.restoreFailed');
        Alert.alert(t('paywall.title'), msg);
      })
      .finally(() => setPurchasing(false));
  };

  // 2026-07-26 사용자 지시 — 프리미엄 혜택(광고 제거/자동넘김 무제한/고급 취침모드)을 명시적으로
  // 나열. 예전엔 RC 상품 목록만 덩그러니 보여줘서 "돈 내면 뭐가 좋아지는지" 자체가 안 보였다.
  // 2026-07-27 사용자 지시로 핸즈프리 컨트롤(손짓/블루투스 리모컨) 게이팅을 다시 무료로 풀면서
  // benefitRemoteControl 삭제 — 이제 실제로 무료 혜택이라 페이월에 남겨두면 "안 되는 걸 된다고
  // 광고"의 반대(되는 걸 유료라고 광고)로 또 다른 허위광고 문제가 된다.
  const benefits = [
    t('paywall.benefitNoAds'),
    t('paywall.benefitUnlimitedAutoNext'),
    t('paywall.benefitAdvancedSleepMode'),
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('paywall.title')}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.close}>{t('paywall.close')}</Text>
        </Pressable>
      </View>
      <FlatList
        data={offerings}
        keyExtractor={(item) => item.identifier}
        contentContainerStyle={{ gap: spacing.sm, padding: spacing.md }}
        ListHeaderComponent={
          <View style={styles.benefitsBox}>
            <Text style={styles.benefitsTitle}>{t('paywall.benefitsTitle')}</Text>
            {benefits.map((b) => (
              <View key={b} style={styles.benefitRow}>
                <Text style={styles.benefitCheck}>✓</Text>
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}
          </View>
        }
        renderItem={({ item }) => {
          // 2026-07-30 사장님 지적 — 월/연 상품의 ASC 표시 이름이 둘 다 "PACE Premium"으로 같아서
          // item.product.title만 쓰면 앱에서 구분이 안 됐다. 상품 "기간"(RC packageType)으로 연간/월간
          // 라벨을 만들어(ASC 이름과 무관하게) 구분 + 가격 옆에 기간(/년,/월)을 붙여 명확히 한다.
          const label = PLAN_LABEL_KEY[item.packageType]
            ? t(PLAN_LABEL_KEY[item.packageType]!)
            : item.product.title;
          const per = PRICE_PERIOD_KEY[item.packageType] ? ` ${t(PRICE_PERIOD_KEY[item.packageType]!)}` : '';
          return (
            <Pressable style={[styles.package, purchasing && styles.packageDisabled]} onPress={() => onPurchase(item)} disabled={purchasing}>
              <Text style={styles.packageTitle}>{label}</Text>
              <Text style={styles.packagePrice}>{item.product.priceString}{per}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          // 2026-07-21 감사 발견 — init()이 실패하면(오프라인 등) 예전엔 "불러오는 중..."에서
          // 영원히 멈췄다(기존 QA #6). initError일 때는 재시도 버튼이 있는 실패 상태를 보여준다.
          // 2026-07-27 사용자 지적("구독화면 왜 이렇게 없어 보이니") — jlpt-master(PremiumPaywallModal)
          // 참고: 실패 상태를 화면 한가운데 텍스트만 덩그러니 두지 않고, 나머지 카드들과 같은
          // 톤의 카드(아이콘 포함)로 감싸 "빈 화면"이 아니라 "디자인된 상태"로 보이게 한다 — 실제
          // 가격 정보는 잘못 표시하면(구버전 가격 등) 법적/신뢰 문제라 지어내지 않고, 대신 재시도를
          // 백오프로 몇 번 자동 반복해(1s/2s/4s) 진짜 일시적 네트워크 흔들림이면 사용자가 버튼을
          // 다시 누르기 전에 스스로 회복할 기회를 준다.
          initError ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <Feather name="cloud-off" size={22} color={colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>{t('paywall.loadFailedTitle')}</Text>
              <Text style={styles.empty}>{t('paywall.loadFailedMessage')}</Text>
              <Pressable style={styles.retryBtn} onPress={() => retryWithBackoff()} disabled={retrying}>
                {retrying ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.retryText}>{t('paywall.retry')}</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={[styles.empty, { marginTop: spacing.sm }]}>{isReady ? t('paywall.loadFailedMessage') : t('paywall.loadingOfferings')}</Text>
            </View>
          )
        }
        ListFooterComponent={
          // App Store Guideline 3.1.2 — 자동갱신 구독은 자동갱신 고지 + 이용약관(EULA) + 개인정보처리방침
          // 링크가 바이너리 안에 있어야 한다(없으면 거의 자동 거부). URL은 constants/legal.ts 참고.
          <View>
            <Pressable style={styles.restoreBtn} onPress={onRestore} disabled={purchasing}>
              {purchasing ? <ActivityIndicator color={colors.textSecondary} /> : <Text style={styles.restoreText}>{t('paywall.restore')}</Text>}
            </Pressable>
            <Text style={styles.autoRenewNotice}>
              {t('paywall.autoRenewNotice', { store: Platform.OS === 'ios' ? 'Apple ID' : 'Google Play' })}
            </Text>
            <View style={styles.legalRow}>
              <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_OF_USE_URL).catch(() => {})}>{t('paywall.termsOfUse')}</Text>
              <Text style={styles.legalDot}> · </Text>
              <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}>{t('paywall.privacyPolicy')}</Text>
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  title: { fontSize: 22, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  close: { color: colors.textSecondary },
  benefitsBox: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
  benefitsTitle: { color: colors.textPrimary, fontFamily: typography.bodyFontFamilyBold, fontSize: 14, marginBottom: 2 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  benefitCheck: { color: colors.success, fontFamily: typography.bodyFontFamilyBold, fontSize: 13 },
  benefitText: { color: colors.textSecondary, fontSize: 13, flexShrink: 1, lineHeight: 18 },
  package: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md },
  packageDisabled: { opacity: 0.5 },
  packageTitle: { fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  packagePrice: { color: colors.textSecondary, marginTop: 4 },
  empty: { color: colors.textSecondary, textAlign: 'center' },
  emptyCard: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.card,
  },
  emptyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { color: colors.textPrimary, fontFamily: typography.bodyFontFamilyBold, fontSize: 15, textAlign: 'center' },
  retryBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.card, borderRadius: radius.pill },
  retryText: { color: colors.textPrimary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
  restoreBtn: { paddingVertical: spacing.md, alignItems: 'center' },
  restoreText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
  autoRenewNotice: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, textAlign: 'center', paddingHorizontal: spacing.md, opacity: 0.75 },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  legalLink: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 12, textDecorationLine: 'underline' },
  legalDot: { color: colors.textSecondary, fontSize: 12 },
});
