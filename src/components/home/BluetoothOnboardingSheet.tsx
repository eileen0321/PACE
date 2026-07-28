import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { bottomSheetPadding, colors, radius, spacing, typography } from '../../constants/theme';
import { capabilities } from '../../services/platform/capabilities';
import { useTranslation } from '../../services/i18n';
import { SnapPulseIllustration } from './SnapPulseIllustration';
import { GestureFlickIllustration } from './GestureFlickIllustration';
import { RemoteClickIllustration } from './RemoteClickIllustration';

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
// 그걸 처음 켜는 유일한 진입점이다. 그래서 컴포넌트를 통째로 숨기는 대신 실제로 벌어지는 일
// (제스처 기반 핸즈프리)로 문구를 바꿨다.
// 2026-07-26 사용자 지시("이어폰 관련 가이드나 문구도 없애 — 이어폰 안 되잖아") — iOS 분기도
// "Bluetooth 헤드셋 버튼(Next/Previous/Play-Pause 전용 미디어 버튼)" 문구를 그대로 뒀었는데(당시
// B1은 Android 스코프였음), 이건 iOS에서도 똑같이 거짓임(§2-C C5, useBluetoothStore/
// bluetoothService.ios.ts가 100% no-op 스텁 — 눌러도 토스트만 뜸). 플랫폼 분기 자체를 없애고
// 핑거스냅/손짓 문구로 통일했었다.
//
// 2026-07-26 사장님 정정("우리 앱에서 되는건 핑거스냅, 손짓, 블루투스 리모컨이야") — 위에서 삭제한
// 건 "전용 미디어 버튼(Play/Pause/Next Track)" 라우팅이고, 이것만 확정적으로 죽어있다(OS가 미디어
// 버튼을 항상 실제 재생 중인 앱으로만 넘김, B1). 그런데 이거랑 별개로 **블루투스 리모컨의 볼륨
// 버튼**을 대리 신호로 쓰는 경로는 실제로 살아있다(PaceAccessibilityService.onKeyEvent — 외부
// 블루투스 장치의 볼륨 버튼만 소비, 폰 자체 물리 버튼은 통과시켜 실제 음량 조절에 영향 없음). 이걸
// 안 넣고 핑거스냅/손짓만 남긴 게 과잉 삭제였다 — 세 번째 방법으로 다시 추가.
export function BluetoothOnboardingSheet({ visible, onEnable, onDismiss }: {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  // 2026-07-26 사장님 결정 번복 — D9 프리미엄 게이팅 삭제, 다시 무료로 개방.
  const handleEnable = () => {
    onEnable();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={[styles.sheet, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.iconWrap}>
            <Feather name="zap" size={22} color={colors.primary} />
          </View>
        </View>
        {/* 2026-07-26 사용자 UX 리뷰 반영(4가지):
            1) 제목을 "Hands-Free Control"(상시 가능한 기능처럼 들림) → "Focus Session Controls"로
               — 실제로는 Focus Session 중에만 동작해서, 일반 유튜브에서 안 되면 "버그인가?" 오해
               소지가 있었음. 이름 자체에 스코프를 박아 기대치 관리.
            2) 가장 중요한 "왜 써야 하는지"(혜택)가 안 보였음 → valueLine 한 줄 추가.
            3) 메커니즘 설명 앞의 "Go hands-free —"는 제목이 이미 커버하므로 중복 제거.
            4) 마지막에 "Focus Session 중에만 동작"이라는 스코프 고지를 명시적으로 한 번 더. */}
        <Text style={styles.title}>{t('handsFreeSheet.title')}</Text>
        <Text style={styles.valueLine}>{t('handsFreeSheet.valueLine')}</Text>
        <Text style={styles.body}>
          {capabilities.supportsFingerSnap ? t('handsFreeSheet.bodyWithSnap') : t('handsFreeSheet.bodyWithoutSnap')}
        </Text>

        {capabilities.supportsFingerSnap && (
          <View style={styles.actionRow}>
            <View style={styles.iconStage}><SnapPulseIllustration /></View>
            <Text style={styles.actionLabel}>{t('handsFreeSheet.fingerSnapLabel')} <Text style={styles.actionArrow}>→</Text> {t('handsFreeSheet.nextShort')}</Text>
          </View>
        )}
        <View style={styles.actionRow}>
          <View style={styles.iconStage}><GestureFlickIllustration /></View>
          <Text style={styles.actionLabel}>{t('handsFreeSheet.handWaveLabel')} <Text style={styles.actionArrow}>→</Text> {t('handsFreeSheet.nextShort')}</Text>
        </View>
        <Text style={styles.handWaveHint}>{t('handsFreeSheet.handWaveHint')}</Text>
        <View style={styles.actionRow}>
          <View style={styles.iconStage}><RemoteClickIllustration /></View>
          <Text style={styles.actionLabel}>{t('handsFreeSheet.bluetoothRemoteLabel')} <Text style={styles.actionArrow}>→</Text> {t('handsFreeSheet.nextShort')}</Text>
        </View>
        <View style={styles.actionRow}>
          <View style={styles.iconStage}><Feather name="play-circle" size={16} color={colors.textSecondary} /></View>
          <Text style={styles.actionLabel}>{t('handsFreeSheet.handsFreeModeLabel')} <Text style={styles.actionArrow}>→</Text> {t('handsFreeSheet.staysOnLabel')}</Text>
        </View>

        <Text style={styles.scopeNote}>{t('handsFreeSheet.scopeNote')}</Text>

        <Pressable onPress={handleEnable} style={styles.enableBtn}>
          <Text style={styles.enableBtnText}>{t('handsFreeSheet.turnOn')}</Text>
        </Pressable>
        <Pressable onPress={onDismiss} style={styles.laterBtn}>
          <Text style={styles.laterBtnText}>{t('handsFreeSheet.notNow')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border },
  handle: { width: 48, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', alignSelf: 'center', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  iconWrap: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: `${colors.primary}1A`, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, marginBottom: spacing.xs },
  valueLine: { fontSize: 13.5, fontFamily: typography.bodyFontFamilySemibold, color: colors.textPrimary, lineHeight: 19, marginBottom: 4 },
  body: { fontSize: 13, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  scopeNote: { fontSize: 11, fontFamily: typography.bodyFontFamilyMedium, color: colors.textTertiary, marginTop: spacing.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  // 2026-07-26 — 각 줄의 손짓 일러스트가 서로 다른 내부 크기를 가져서 그대로 두면 줄마다 라벨
  // 시작 위치가 어긋난다. 모든 줄의 아이콘을 이 고정 크기 스테이지 안에 가운데 정렬해 라벨이 항상
  // 같은 x에서 시작하게 한다. 2026-07-27 — 아이콘 자체를 56x50으로 키워서 스테이지도 맞춰 확대.
  iconStage: { width: 56, height: 50, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary },
  handWaveHint: { fontSize: 11, fontFamily: typography.bodyFontFamilyMedium, color: colors.textTertiary, lineHeight: 16, marginTop: -spacing.xs, marginBottom: spacing.xs, marginLeft: 44 },
  actionArrow: { color: colors.textTertiary },
  enableBtn: { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  enableBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold },
  laterBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  laterBtnText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
});
