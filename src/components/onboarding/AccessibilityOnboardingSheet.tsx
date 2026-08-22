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
//
// 2026-07-25 B1 — 이 시트는 Android 전용(settings.tsx의 `Platform.OS === 'android'` 블록에서만
// 띄움, Accessibility Service 자체가 Android 개념). 원래 benefit 3줄 중 "Bluetooth/AirPods
// Control"은 하드웨어 리모컨으로 YouTube를 조작할 수 있다는 뜻인데, Android OS가 미디어 버튼을
// 서드파티 앱에 절대 안 넘겨줘서 확정적으로 불가능함이 확인됐다(QA_ANDROID_LIFECYCLE_2026-07-22.md
// #B22) — 접근성 권한을 켜도 이 혜택은 생기지 않으므로 삭제. 나머지 두 줄(Focus Session/Hands-Free
// Mode)은 실제로 이 권한이 있어야 동작하는 핑거스냅·손 밀어내기 스와이프라 그대로 유지.
export function AccessibilityOnboardingSheet({ visible, onEnable, onDismiss }: {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={[styles.sheet, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
        <View style={styles.handle} />
        <View style={styles.iconWrap}>
          <Feather name="unlock" size={22} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('focus.a11ySheetTitle')}</Text>
        <Text style={styles.body}>{t('focus.a11ySheetBody')}</Text>

        {/* 🔴 2026-08-22 — Play 정책(Prominent disclosure)의 What/How를 채우는 부분.
            기존엔 "포커스 세션 / 핸즈프리 모드" 두 단어만 있어서 **무엇을 읽고 무엇을 하는지**가
            전혀 없었다. 정책은 "관련된 모든 데이터 유형"과 "핵심 기능 맥락에서의 사용 방식"을
            요구한다 — 접근성 서비스가 실제로 하는 네 가지를 그대로 적는다(코드 기준, 추측 아님). */}
        {(['a11ySheetUse1', 'a11ySheetUse2', 'a11ySheetUse3', 'a11ySheetUse4'] as const).map((key) => (
          <View key={key} style={styles.useRow}>
            <Feather name="check" size={14} color={colors.successLight} style={styles.useIcon} />
            <Text style={styles.useText}>{t(`focus.${key}`)}</Text>
          </View>
        ))}

        {/* 정책이 요구하는 "하지 않는 것"과 철회 방법 — 동의 판단에 필요한 정보다. */}
        <Text style={styles.privacy}>{t('focus.a11ySheetPrivacy')}</Text>

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
  // 설명이 한 줄로 안 끝나므로 아이콘을 위로 정렬하고(alignItems: 'flex-start') 텍스트는 줄바꿈시킨다.
  useRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 4 },
  useIcon: { marginTop: 3 },
  useText: { flex: 1, fontSize: 12.5, fontFamily: typography.bodyFontFamilyMedium, color: colors.textPrimary, lineHeight: 18 },
  privacy: { fontSize: 12, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, lineHeight: 17, marginTop: spacing.sm },
  pathBox: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.chip, padding: spacing.sm, marginTop: spacing.sm },
  pathLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  pathText: { fontSize: 12, fontFamily: typography.monoFontFamilyBold, color: colors.primary },
  enableBtn: { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  enableBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold },
  laterBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  laterBtnText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
});
