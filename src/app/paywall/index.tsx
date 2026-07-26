import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View, Pressable, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useUserStore } from '../../store/useUserStore';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';

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

  // 2026-07-26 사용자 지시 — 프리미엄 혜택(광고 제거/자동넘김 무제한/리모컨/고급 취침모드)을 명시적으로
  // 나열. 예전엔 RC 상품 목록만 덩그러니 보여줘서 "돈 내면 뭐가 좋아지는지" 자체가 안 보였다.
  const benefits = [
    t('paywall.benefitNoAds'),
    t('paywall.benefitUnlimitedAutoNext'),
    t('paywall.benefitRemoteControl'),
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
        renderItem={({ item }) => (
          <Pressable style={[styles.package, purchasing && styles.packageDisabled]} onPress={() => onPurchase(item)} disabled={purchasing}>
            <Text style={styles.packageTitle}>{item.product.title}</Text>
            <Text style={styles.packagePrice}>{item.product.priceString}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          // 2026-07-21 감사 발견 — init()이 실패하면(오프라인 등) 예전엔 "불러오는 중..."에서
          // 영원히 멈췄다(기존 QA #6). initError일 때는 재시도 버튼이 있는 실패 상태를 보여준다.
          initError ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('paywall.loadFailedTitle')}</Text>
              <Text style={styles.empty}>{t('paywall.loadFailedMessage')}</Text>
              <Pressable style={styles.retryBtn} onPress={() => init()}>
                <Text style={styles.retryText}>{t('paywall.retry')}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.empty}>{isReady ? t('paywall.loadFailedMessage') : t('paywall.loadingOfferings')}</Text>
          )
        }
        ListFooterComponent={
          <Pressable style={styles.restoreBtn} onPress={onRestore} disabled={purchasing}>
            {purchasing ? <ActivityIndicator color={colors.textSecondary} /> : <Text style={styles.restoreText}>{t('paywall.restore')}</Text>}
          </Pressable>
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
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg },
  emptyState: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  emptyTitle: { color: colors.textPrimary, fontFamily: typography.bodyFontFamilyBold, fontSize: 15 },
  retryBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.card, borderRadius: radius.pill },
  retryText: { color: colors.textPrimary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
  restoreBtn: { paddingVertical: spacing.md, alignItems: 'center' },
  restoreText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
});
