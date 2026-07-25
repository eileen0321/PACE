import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { bottomSheetPadding, colors, radius, spacing, typography } from '../constants/theme';
import { useSettingsStore } from '../store/useSettingsStore';

// 2026-07-25 사용자 지적("몇번을 말하는데 안고쳐") — QuickControlSheet를 RN <Modal>로 띄우는 한
// navigationBarTranslucent/statusBarTranslucent를 다 켜도 하단 내비게이션 바가 흰색으로 남는
// 문제가 반복됐다. 웹서치로 확인한 근본 원인: SDK 57부터 강제된 Android edge-to-edge 아래에서
// RN 내장 Modal은 자기만의 별도 네이티브 창을 새로 띄우는데, 그 창은 액티비티의
// edge-to-edge/투명 내비게이션 바 설정을 상속하지 않는 게 알려진 업스트림 한계다
// (expo/expo#39749 — "In edge-to-edge Android, using React Native Modal imposes non-transparency
// on navigation bar"). 같은 이슈에서 공식적으로 권장하는 회피책이 "expo-router의 모달 화면을 쓰라"
// (react-navigation native-stack의 transparentModal 프레젠테이션은 새 네이티브 창이 아니라 같은
// 액티비티 안에서 전환되므로 액티비티 테마의 투명 내비게이션 바를 그대로 물려받는다). 그래서
// Sleep Timer/Daily Limit/Break Reminder 시트를 Modal 컴포넌트에서 이 라우트로 옮긴다 —
// UI/동작은 기존 QuickControlSheet과 동일, 여는 방식만 로컬 state+Modal에서 router.push로 교체.
const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60];
const DAILY_LIMIT_OPTIONS = [15, 30, 45, 60, 90, 120];
const BREAK_OPTIONS = [0, 10, 15, 20, 30];

export type QuickControlSheetKind = 'sleepTimer' | 'dailyLimit' | 'breakReminder';

export default function QuickControlSheetScreen() {
  const { kind } = useLocalSearchParams<{ kind: QuickControlSheetKind }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettingsStore();
  const close = () => router.back();

  const config =
    kind === 'dailyLimit'
      ? {
          title: 'Daily Limit',
          description: 'Set healthy boundaries for shorts platforms',
          icon: 'clock' as const,
          options: DAILY_LIMIT_OPTIONS.map((m) => ({ label: `${m}m`, value: m })),
          selectedValue: settings.dailyLimitMinutes,
          onSelect: (v: number) => update({ dailyLimitMinutes: v }),
        }
      : kind === 'breakReminder'
        ? {
            title: 'Break Reminder',
            description: 'Take short breaks during your session',
            icon: 'coffee' as const,
            options: BREAK_OPTIONS.map((m) => ({ label: m === 0 ? 'OFF' : `${m}m`, value: m })),
            selectedValue: settings.breakIntervalMinutes,
            onSelect: (v: number) => update({ breakIntervalMinutes: v }),
          }
        : {
            title: 'Sleep Timer',
            description: 'Stop and lock short session automatically',
            icon: 'moon' as const,
            options: SLEEP_TIMER_OPTIONS.map((m) => ({ label: m === 0 ? 'OFF' : `${m}m`, value: m })),
            selectedValue: settings.sleepTimerMinutes ?? 0,
            onSelect: (v: number) => update({ sleepTimerMinutes: v === 0 ? null : v }),
          };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{config.title}</Text>
            <Text style={styles.description}>{config.description}</Text>
          </View>
          <View style={styles.iconBadge}>
            <Feather name={config.icon} size={16} color={colors.primary} />
          </View>
        </View>
        <View style={styles.options}>
          {config.options.map((opt) => {
            const selected = opt.value === config.selectedValue;
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => { config.onSelect(opt.value); close(); }}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt.label}</Text>
                {selected && <Feather name="check" size={16} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border },
  handle: { width: 48, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', alignSelf: 'center', marginBottom: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  headerText: { flex: 1, paddingRight: spacing.sm },
  title: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  description: { fontSize: 11, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, marginTop: 2 },
  iconBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: `${colors.primary}1A`, alignItems: 'center', justifyContent: 'center' },
  options: { gap: spacing.xs },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sm + 2, borderRadius: radius.button, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'transparent' },
  optionSelected: { backgroundColor: `${colors.primary}1A`, borderColor: `${colors.primary}4D` },
  optionText: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  optionTextSelected: { color: colors.primary, fontFamily: typography.bodyFontFamilyExtrabold },
});
