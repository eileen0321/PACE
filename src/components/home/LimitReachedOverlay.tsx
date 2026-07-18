import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(3) App.tsx의 "APPLE SCREEN TIME LOCKOUT OVERLAY"를 이식(App.tsx:710-767) —
// 일일 한도 도달 시 Home에서 보여주는 전체화면 잠금 안내. 원본의 두 버튼(Request 15 More Minutes/
// Ignore Limit for Today)과 텍스트 링크(Decline: Reduce Watched Time) 중 마지막 둘은 이식하지 않음 —
// 코드 주석에 직접 "Temporarily set limit extremely high for active testing bypass"라고 적힌 테스트용
// 치트키였다(하루 한도를 사실상 무제한으로 풀거나, 실제 시청 기록을 조작해 되돌리는 기능은 이 앱의
// 핵심 가치와 정면으로 배치). 실제 프로덕션 기능인 "Request 15 More Minutes"(useDailyBonusStore.
// addMinutes, Focus 탭 Extend Time과 동일한 진짜 메커니즘)만 유지하고, 나머지 자리에는 정직한
// "Not Now" 닫기 버튼을 둔다.
export function LimitReachedOverlay({ visible, limitMinutes, onExtend, onDismiss }: {
  visible: boolean;
  limitMinutes: number;
  onExtend: () => void;
  onDismiss: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.spacer} />
        <View style={styles.centerBlock}>
          <View style={styles.iconWrap}>
            <Feather name="shield" size={28} color={colors.dangerLight} />
          </View>
          <Text style={styles.title}>Time Limit</Text>
          <Text style={styles.subtitle}>PACE SESSION GUARD</Text>
          <Text style={styles.body}>
            You've used your daily limit of <Text style={styles.bold}>{limitMinutes} minutes</Text> of short
            videos. Taking rest breaks promotes better sleep hygiene, improved attention span, and mental clarity.
          </Text>
        </View>
        <View style={styles.buttonBlock}>
          <Pressable onPress={onExtend} style={styles.extendBtn}>
            <Text style={styles.extendBtnText}>Request 15 More Minutes</Text>
          </Pressable>
          <Pressable onPress={onDismiss} style={styles.dismissBtn}>
            <Text style={styles.dismissBtnText}>Not Now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,12,15,0.97)', paddingHorizontal: spacing.xl, paddingVertical: 48, justifyContent: 'space-between' },
  spacer: { flex: 1 },
  centerBlock: { alignItems: 'center' },
  iconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { fontSize: 30, fontFamily: typography.displayFontFamily, color: '#FFFFFF', letterSpacing: -0.5 },
  subtitle: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase', marginTop: 4 },
  body: { fontSize: 14, fontFamily: typography.bodyFontFamilyMedium, color: '#D1D5DB', textAlign: 'center', lineHeight: 21, maxWidth: 300, marginTop: spacing.lg },
  bold: { fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF' },
  buttonBlock: { gap: spacing.sm, width: '100%', maxWidth: 320, alignSelf: 'center' },
  extendBtn: { width: '100%', paddingVertical: spacing.md, backgroundColor: colors.primary, borderRadius: radius.pill, alignItems: 'center' },
  extendBtnText: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF' },
  dismissBtn: { width: '100%', paddingVertical: spacing.sm + 4, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, alignItems: 'center' },
  dismissBtnText: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF' },
});
