import { StyleSheet, Text, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../../constants/theme';

export default function OnboardingScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Pace</Text>
        <Text style={styles.subtitle}>숏폼 콘텐츠를 편하게 소비하면서도{'\n'}사용 시간을 통제할 수 있는 디지털 웰빙 앱</Text>
      </View>
      <Pressable style={styles.cta} onPress={() => router.replace('/(tabs)/home')}>
        <Text style={styles.ctaText}>시작하기</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'space-between' },
  content: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { fontSize: 40, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 16, color: colors.textSecondary, lineHeight: 24 },
  cta: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.md, alignItems: 'center' },
  ctaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});
