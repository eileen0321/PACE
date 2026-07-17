import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../constants/theme';

// healthy-shorts-assistant의 Header.tsx 포팅. iOS 상태바(시간/배터리 등)는 실기기가 이미 그려주므로
// 제외하고, "Good Evening" 인사 + 이니셜 아바타만 이식.
export function AppHeader({ userEmail }: { userEmail: string }) {
  const [greeting, setGreeting] = useState('Hello');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good Morning');
    else if (hour < 18) setGreeting('Good Afternoon');
    else setGreeting('Good Evening');
  }, []);

  const name = userEmail.split('@')[0] || 'guest';
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  const initial = name.slice(0, 2).toUpperCase();

  return (
    <View style={styles.header}>
      <View>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{greeting}</Text>
          <Feather name="moon" size={20} color={colors.primary} />
        </View>
        <Text style={styles.subtitle}>Stay mindful of your time.</Text>
      </View>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.avatarName}>{capitalizedName}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 4, fontWeight: '500' },
  avatarWrap: { alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  avatarName: { fontSize: 10, fontWeight: '600', color: colors.textSecondary, marginTop: 6 },
});
