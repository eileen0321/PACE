import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { bottomSheetPadding, colors, radius, spacing, typography } from '../../constants/theme';

// 2026-07-19: Bluetooth Hands-Free Control 최초 1회 안내(사용자 지시, Copilot 스펙 정리 반영) —
// 사용자가 Home에서 플랫폼 카드를 처음 탭할 때 세션 시작 전에 뜬다(home.tsx). "Enable"/"Not Now"
// 둘 다 다시 안 보이게 처리(STORAGE_KEYS.bluetoothOnboardingSeen) — Enable은 추가로 세션 시작과
// 동시에 Auto Mode를 켜서 바로 손 안 대고 쓰는 경험을 준다.
export function BluetoothOnboardingSheet({ visible, onEnable, onDismiss }: {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={[styles.sheet, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Feather name="headphones" size={22} color={colors.primary} />
        </View>
        <Text style={styles.title}>Hands-Free Control</Text>
        <Text style={styles.body}>Use your Bluetooth headset to control Shorts without touching your screen.</Text>

        <View style={styles.actionRow}>
          <Feather name="skip-forward" size={16} color={colors.textSecondary} />
          <Text style={styles.actionLabel}>Next button <Text style={styles.actionArrow}>→</Text> Next Short</Text>
        </View>
        <View style={styles.actionRow}>
          <Feather name="skip-back" size={16} color={colors.textSecondary} />
          <Text style={styles.actionLabel}>Previous button <Text style={styles.actionArrow}>→</Text> Previous Short</Text>
        </View>
        <View style={styles.actionRow}>
          <Feather name="play" size={16} color={colors.textSecondary} />
          <Text style={styles.actionLabel}>Play / Pause <Text style={styles.actionArrow}>→</Text> Toggle Auto Mode</Text>
        </View>

        <Pressable onPress={onEnable} style={styles.enableBtn}>
          <Text style={styles.enableBtnText}>Enable</Text>
        </Pressable>
        <Pressable onPress={onDismiss} style={styles.laterBtn}>
          <Text style={styles.laterBtnText}>Not Now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border },
  handle: { width: 48, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', alignSelf: 'center', marginBottom: spacing.md },
  iconWrap: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: `${colors.primary}1A`, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { fontSize: 17, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, marginBottom: spacing.xs },
  body: { fontSize: 13, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  actionLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary },
  actionArrow: { color: colors.textTertiary },
  enableBtn: { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  enableBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold },
  laterBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  laterBtnText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
});
