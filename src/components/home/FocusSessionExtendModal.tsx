import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../services/i18n';
import { bluetoothService } from '../../services/platform';
import { showRewardedAd } from '../../services/ads/rewardedAd';
import { useToastStore } from '../../store/useToastStore';
import { useFlipStore } from '../../store/useFlipStore';
import { useAttendanceStore } from '../../store/useAttendanceStore';
import { colors, radius, spacing, typography } from '../../constants/theme';

export const FOCUS_SESSION_EXTEND_MINUTES = 5;

// 2026-07-26 사용자 지시(Focus Session/연속 시청 통합 결정, PACE_PROJECT_MANAGEMENT.md 참고) — 무료
// Focus Session(10분 고정)이 시간이 다 돼서 자동으로 꺼졌을 때(사용자가 직접 끈 게 아니라) ①보상형
// 광고 또는 ②크레딧(5개, 휴식 크레딧+출석 보너스 합산, 1크레딧=1분)으로 5분 더 이어갈 수 있게 하는
// 모달 — 예전 overlay/index.tsx의 "자동넘김 30편 한도" 모달을 완전히 대체한다(그 시스템은 제거됨).
// Home 화면이 AppState 'active'마다 bluetoothService.consumeFocusSessionTimedOut()을 1회성 소비
// 확인해 이 모달을 띄운다.
export function FocusSessionExtendModal({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const { t } = useTranslation();
  const [watchingAd, setWatchingAd] = useState(false);
  const restCredits = useFlipStore((s) => s.credits);
  const bonusCredits = useAttendanceStore((s) => s.bonusCredits);
  const totalCredits = restCredits + bonusCredits;

  const onWatchAd = () => {
    setWatchingAd(true);
    showRewardedAd().then((result) => {
      setWatchingAd(false);
      if (result === 'earned') {
        bluetoothService.extendFocusSession(FOCUS_SESSION_EXTEND_MINUTES).catch(() => {});
        useToastStore.getState().show(t('home.focusSessionExtendedToast', { extend: FOCUS_SESSION_EXTEND_MINUTES }));
        onDismiss();
      } else if (result === 'failed') {
        useToastStore.getState().show(t('overlay.autoNextAdFailed'));
      }
      // 'closed_without_reward' — 모달을 유지해 다시 시도할 수 있게 한다.
    });
  };

  const onUseCredits = () => {
    const need = FOCUS_SESSION_EXTEND_MINUTES;
    const spentRest = useFlipStore.getState().spendCredits(Math.min(need, restCredits));
    const spentBonus = useAttendanceStore.getState().spendBonusCredits(Math.min(need - spentRest, bonusCredits));
    const spent = spentRest + spentBonus;
    if (spent <= 0) return;
    bluetoothService.extendFocusSession(spent).catch(() => {});
    useToastStore.getState().show(t('home.focusSessionExtendedToast', { extend: spent }));
    onDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('home.focusSessionTimedOutTitle')}</Text>
          <Text style={styles.message}>{t('home.focusSessionTimedOutMessage', { extend: FOCUS_SESSION_EXTEND_MINUTES })}</Text>
          <Pressable style={[styles.btn, styles.btnPrimary, watchingAd && styles.btnDisabled]} onPress={onWatchAd} disabled={watchingAd}>
            {watchingAd ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.btnPrimaryText}>{t('home.watchAdToExtend', { extend: FOCUS_SESSION_EXTEND_MINUTES })}</Text>
            )}
          </Pressable>
          {totalCredits >= FOCUS_SESSION_EXTEND_MINUTES && (
            <Pressable style={[styles.btn, styles.btnCredits]} onPress={onUseCredits} disabled={watchingAd}>
              <Text style={styles.btnCreditsText}>{t('home.useCreditsToExtend', { credits: FOCUS_SESSION_EXTEND_MINUTES, extend: FOCUS_SESSION_EXTEND_MINUTES })}</Text>
            </Pressable>
          )}
          <Pressable style={styles.btn} onPress={onDismiss} disabled={watchingAd}>
            <Text style={styles.btnText}>{t('overlay.notNow')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.bodyFontFamilyBold },
  message: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.sm },
  btn: { borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.primary },
  btnDisabled: { opacity: 0.7 },
  btnPrimaryText: { color: colors.background, fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
  btnCredits: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' },
  btnCreditsText: { color: colors.successLight, fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
  btnText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
});
