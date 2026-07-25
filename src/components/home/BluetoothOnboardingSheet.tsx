import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { bottomSheetPadding, colors, radius, spacing, typography } from '../../constants/theme';

// 2026-07-19: Bluetooth Hands-Free Control 최초 1회 안내(사용자 지시, Copilot 스펙 정리 반영) —
// 사용자가 Home에서 플랫폼 카드를 처음 탭할 때 세션 시작 전에 뜬다(home.tsx). "Enable"/"Not Now"
// 둘 다 다시 안 보이게 처리(STORAGE_KEYS.bluetoothOnboardingSeen) — Enable은 추가로 세션 시작과
// 동시에 Auto Mode를 켜서 바로 손 안 대고 쓰는 경험을 준다.
//
// 2026-07-25 B1 정정 — 원래 문구("Bluetooth 헤드셋 버튼으로 Next/Previous/Play-Pause 조작")는
// Android에서 100% 거짓이다: OS가 서드파티 앱에 미디어 버튼을 절대 안 넘겨줘서 하드웨어 리모컨
// 경로는 확정적으로 불가능하고(QA_ANDROID_LIFECYCLE_2026-07-22.md #B22), 그 대체 진입점이었던
// 인앱 Next/Prev 버튼도 이미 삭제됐다(#B26). 그런데 이 시트의 "Enable" 버튼 자체는 지우면 안 된다
// — Android에서 실제로 동작하는 건 핑거스냅/손 밀어내기/자동재생 워처로 이뤄진 Auto Mode(Focus
// Session, PaceSnapDetector/PaceHandWaveDetector — PACE_ARCHITECTURE.md 참고)이고, 이 시트가
// 그걸 처음 켜는 유일한 진입점이다. 그래서 컴포넌트를 통째로 숨기는 대신 Android에서만 실제로
// 벌어지는 일(제스처 기반 핸즈프리)로 문구를 바꿨다 — iOS는 이 store/service 경로가 여전히 스텁
// (bluetoothService.ios.ts)이라 기존 Bluetooth 헤드셋 문구를 그대로 둔다(변경 없음).
export function BluetoothOnboardingSheet({ visible, onEnable, onDismiss }: {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const isAndroid = Platform.OS === 'android';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={[styles.sheet, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Feather name={isAndroid ? 'zap' : 'headphones'} size={22} color={colors.primary} />
        </View>
        <Text style={styles.title}>Hands-Free Control</Text>
        <Text style={styles.body}>
          {isAndroid
            ? "Go hands-free without a headset — Pace can advance Shorts from a finger snap or a hand wave."
            : 'Use your Bluetooth headset to control Shorts without touching your screen.'}
        </Text>

        {isAndroid ? (
          <>
            <View style={styles.actionRow}>
              <Feather name="mic" size={16} color={colors.textSecondary} />
              <Text style={styles.actionLabel}>Finger snap <Text style={styles.actionArrow}>→</Text> Next Short</Text>
            </View>
            <View style={styles.actionRow}>
              <Feather name="camera" size={16} color={colors.textSecondary} />
              <Text style={styles.actionLabel}>Hand wave <Text style={styles.actionArrow}>→</Text> Next Short</Text>
            </View>
            <View style={styles.actionRow}>
              <Feather name="play-circle" size={16} color={colors.textSecondary} />
              <Text style={styles.actionLabel}>Auto Mode <Text style={styles.actionArrow}>→</Text> Hands-free for your Focus Session</Text>
            </View>
          </>
        ) : (
          <>
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
              <Text style={styles.actionLabel}>Play / Pause <Text style={styles.actionArrow}>→</Text> Toggle Focus Session</Text>
            </View>
          </>
        )}

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
