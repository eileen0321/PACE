import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../services/i18n';
import { bottomSheetPadding, colors, radius, spacing, typography } from '../../constants/theme';

// 2026-07-19: 사용자 지시(Copilot UX 제안 정리, 축소 버전) — Android 접근성 권한을 아무 설명 없이
// 바로 시스템 설정으로 튕기던 문제(overlay/index.tsx 세션 시작 시 자동 트리거, focus.tsx 권한 행 탭)를
// 고친다. Copilot 원안의 이미지/애니메이션 단계별 가이드 오버레이("1.Accessibility→2.Installed
// Apps→3.PACE→4.Turn ON" 도식)와 축하 화면은 이식하지 않음 — 제조사(삼성/픽셀 등)·Android 버전마다
// 실제 접근성 설정 화면 레이아웃이 달라서 고정 이미지 가이드는 오히려 틀린 화면을 보여줄 위험이 크다.
// 대신 텍스트 경로 안내 하나로 충분 + 실제 복귀 감지(overlay/index.tsx의 AppState 리스너)로 성공
// 여부를 스스로 재확인해 토스트로 알려주므로 유저가 "잘 됐는지" 직접 눈으로 단계를 맞춰볼 필요가 없다.
// Bluetooth = 선택 기능인 것과 동일하게, Auto Next/접근성도 선택 기능이라는 원칙(Copilot 대화 후반부
// 정정 내용)에 맞춰 "Setup Required" 같은 경고 문구 없이 "이걸 켜면 뭐가 좋아지는지"만 설명한다.
export function AccessibilityOnboardingSheet({ visible, onEnable, onDismiss }: {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={[styles.sheet, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Feather name="unlock" size={22} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('focus.a11ySheetTitle')}</Text>
        <Text style={styles.body}>{t('focus.a11ySheetBody')}</Text>

        <View style={styles.benefitRow}>
          <Feather name="check" size={14} color={colors.successLight} />
          <Text style={styles.benefitLabel}>{t('focus.a11ySheetBenefitAutoNext')}</Text>
        </View>
        <View style={styles.benefitRow}>
          <Feather name="check" size={14} color={colors.successLight} />
          <Text style={styles.benefitLabel}>{t('focus.a11ySheetBenefitBluetooth')}</Text>
        </View>
        <View style={styles.benefitRow}>
          <Feather name="check" size={14} color={colors.successLight} />
          <Text style={styles.benefitLabel}>{t('focus.a11ySheetBenefitHandsFree')}</Text>
        </View>

        <View style={styles.pathBox}>
          <Text style={styles.pathLabel}>{t('focus.a11ySheetPathLabel')}</Text>
          <Text style={styles.pathText}>{t('focus.a11ySheetPathText')}</Text>
        </View>

        <Pressable onPress={onEnable} style={styles.enableBtn}>
          <Text style={styles.enableBtnText}>{t('focus.a11ySheetEnable')}</Text>
        </Pressable>
        <Pressable onPress={onDismiss} style={styles.laterBtn}>
          <Text style={styles.laterBtnText}>{t('focus.a11ySheetNotNow')}</Text>
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
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  benefitLabel: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  pathBox: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.chip, padding: spacing.sm, marginTop: spacing.sm },
  pathLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  pathText: { fontSize: 12, fontFamily: typography.monoFontFamilyBold, color: colors.primary },
  enableBtn: { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  enableBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold },
  laterBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  laterBtnText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
});
