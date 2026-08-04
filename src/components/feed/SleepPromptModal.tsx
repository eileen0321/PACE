import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../services/i18n';
import { colors, radius, spacing, typography } from '../../constants/theme';

// 2026-08-04 수면감지 2단계(안드 PaceOverlayService.showStillWatchingPrompt 패리티, useSleepGuard.ios.ts
// 참고) — "아직 보고 계세요?" 확인 팝업. 버튼이든 배경이든 어떤 반응이든 "사람이 반응했다"는 가장 확실한
// 깨어있음 증거이므로 onKeepWatching 하나로 통일(안드도 카드 버튼과 배경 탭이 같은 markUserActivity를 태움).
export function SleepPromptModal({ visible, onKeepWatching }: { visible: boolean; onKeepWatching: () => void }) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <Pressable style={styles.backdrop} onPress={onKeepWatching}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Feather name="moon" size={22} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('feed.sleepPromptTitle')}</Text>
        <Text style={styles.message}>{t('feed.sleepPromptBody')}</Text>
        <Pressable style={styles.btn} onPress={onKeepWatching}>
          <Text style={styles.btnText}>{t('feed.sleepPromptButton')}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: { width: '100%', maxWidth: 320, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, alignItems: 'center', gap: spacing.xs },
  iconWrap: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.bodyFontFamilyBold, textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: spacing.sm },
  btn: {
    alignSelf: 'stretch',
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  btnText: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
});
