import { StyleSheet, Text, View, Pressable, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { colors, radius, spacing } from '../../constants/theme';

export default function PaywallScreen() {
  const router = useRouter();
  const { offerings, purchase } = useSubscriptionStore();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pace Premium</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.close}>닫기</Text>
        </Pressable>
      </View>
      <FlatList
        data={offerings}
        keyExtractor={(item) => item.identifier}
        contentContainerStyle={{ gap: spacing.sm, padding: spacing.md }}
        renderItem={({ item }) => (
          <Pressable style={styles.package} onPress={() => purchase(item)}>
            <Text style={styles.packageTitle}>{item.product.title}</Text>
            <Text style={styles.packagePrice}>{item.product.priceString}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>상품 정보를 불러오는 중...</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  close: { color: colors.textSecondary },
  package: { backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.md },
  packageTitle: { fontWeight: '700', color: colors.textPrimary },
  packagePrice: { color: colors.textSecondary, marginTop: 4 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg },
});
