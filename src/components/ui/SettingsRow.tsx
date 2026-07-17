import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../constants/theme';

// healthy-shorts-assistant의 SettingsSection.tsx 행 패턴(제목/설명 + 우측 토글 or 값 pill)을
// 재사용 가능한 프리미티브로 추출. SectionCard로 감싸 divide-y 스타일의 그룹을 만든다.
export function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function ToggleRow({ title, description, value, onToggle }: { title: string; description: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowStatus, { color: value ? colors.primary : colors.textSecondary }]}>{value ? 'ON' : 'OFF'}</Text>
        <Switch value={value} onValueChange={onToggle} trackColor={{ true: colors.primary, false: colors.border }} />
      </View>
    </Pressable>
  );
}

export function ValueRow({ title, description, value, onPress }: { title: string; description: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      <View style={styles.valuePill}>
        <Text style={styles.valuePillText}>{value}</Text>
      </View>
    </Pressable>
  );
}

export function ShieldRow({ title, description, active, onToggle }: { title: string; description: string; active: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={styles.row}>
      <View style={styles.shieldLeft}>
        <View style={[styles.shieldIcon, { backgroundColor: active ? colors.successBg : colors.background }]}>
          <Feather name="shield" size={16} color={active ? colors.success : colors.textSecondary} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitleSm}>{title}</Text>
          <Text style={styles.rowDesc}>{description}</Text>
        </View>
      </View>
      <View style={[styles.shieldBadge, { backgroundColor: active ? colors.successBg : colors.background }]}>
        <Text style={[styles.shieldBadgeText, { color: active ? colors.success : colors.textSecondary }]}>{active ? 'ON' : 'OFF'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.background },
  rowText: { flex: 1, paddingRight: spacing.sm },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowStatus: { fontSize: 13, fontWeight: '800' },
  valuePill: { backgroundColor: colors.cardMuted, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 6 },
  valuePillText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  shieldLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  shieldIcon: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  rowTitleSm: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  shieldBadge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  shieldBadgeText: { fontSize: 11, fontWeight: '800' },
});
