import { Alert, StyleSheet, Text, View, Pressable, FlatList } from 'react-native';
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
  const { offerings, purchase, restore } = useSubscriptionStore();

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

  const onPurchase = (pkg: (typeof offerings)[number]) => {
    if (blockIfNotSignedIn()) return;
    purchase(pkg).catch((e) => Alert.alert(t('paywall.title'), e?.message ?? String(e)));
  };

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
        renderItem={({ item }) => (
          <Pressable style={styles.package} onPress={() => onPurchase(item)}>
            <Text style={styles.packageTitle}>{item.product.title}</Text>
            <Text style={styles.packagePrice}>{item.product.priceString}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t('paywall.loadingOfferings')}</Text>}
        ListFooterComponent={
          <Pressable
            style={styles.restoreBtn}
            onPress={() => { if (!blockIfNotSignedIn()) restore().catch(() => {}); }}
          >
            <Text style={styles.restoreText}>{t('paywall.restore')}</Text>
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
  package: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md },
  packageTitle: { fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  packagePrice: { color: colors.textSecondary, marginTop: 4 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg },
  restoreBtn: { paddingVertical: spacing.md, alignItems: 'center' },
  restoreText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
});
