import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation, type TranslationKey } from '../../services/i18n';
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
// 2026-08-01 사용자 지시("룰을 다시 정해 — focus on 다 보면 5분 1회만 더 주기, 그다음부턴 광고/
// 크레딧") — 하루 한도(LimitReachedOverlay)도 같은 광고/크레딧 게이트가 필요해졌다. onExtend를
// prop으로 받게 일반화해서 Focus Session 타이머(bluetoothService.extendFocusSession)와 하루 한도
// (addBonusMinutes) 양쪽에서 이 모달 하나를 재사용한다 — 로직 중복 없이 동일한 규칙을 보장.
export function FocusSessionExtendModal({ visible, onDismiss, onExtend, titleKey = 'home.focusSessionTimedOutTitle', messageKey = 'home.focusSessionTimedOutMessage' }: {
  visible: boolean;
  onDismiss: () => void;
  onExtend?: (minutes: number) => void;
  titleKey?: TranslationKey;
  messageKey?: TranslationKey;
}) {
  const { t } = useTranslation();
  const [watchingAd, setWatchingAd] = useState(false);
  // 2026-07-26 감사 발견 — onWatchAd는 watchingAd로 막혀 있었지만 onUseCredits는 아무 가드가 없었다.
  // spendCredits/spendBonusCredits 자체는 잔액을 넘게 못 쓰도록 clamp돼 있어 마이너스가 되진
  // 않지만, onDismiss()가 실제로 모달을 없애기 전(부모 state 갱신 1틱 지연) 빠르게 두 번 탭하면
  // 보유 크레딧을 의도한 것보다 2배(최대 FOCUS_SESSION_EXTEND_MINUTES*2)까지 써버릴 수 있었다.
  const [usingCredits, setUsingCredits] = useState(false);
  const restCredits = useFlipStore((s) => s.credits);
  const bonusCredits = useAttendanceStore((s) => s.bonusCredits);
  const totalCredits = restCredits + bonusCredits;
  const grant = onExtend ?? ((minutes: number) => { bluetoothService.extendFocusSession(minutes).catch(() => {}); });

  const onWatchAd = () => {
    setWatchingAd(true);
    showRewardedAd().then((result) => {
      setWatchingAd(false);
      if (result === 'earned') {
        grant(FOCUS_SESSION_EXTEND_MINUTES);
        useToastStore.getState().show(t('home.focusSessionExtendedToast', { extend: FOCUS_SESSION_EXTEND_MINUTES }));
        onDismiss();
      } else if (result === 'failed') {
        useToastStore.getState().show(t('overlay.autoNextAdFailed'));
      }
      // 'closed_without_reward' — 모달을 유지해 다시 시도할 수 있게 한다.
    });
  };

  const onUseCredits = () => {
    if (usingCredits) return;
    setUsingCredits(true);
    // ⚠️ 감사 발견: usingCredits를 켠 뒤 리셋하는 경로가 없어서, 크레딧 1회 사용(또는 spent<=0 조기반환)
    // 뒤로 Watch Ad/Use Credits 두 버튼이 영구 비활성됐다(모달은 if(!visible)return null이라 언마운트 안 됨
    // → state 유지). try/finally로 항상 false로 되돌린다. spendCredits는 동기라 finally가 즉시 실행됨.
    try {
      const need = FOCUS_SESSION_EXTEND_MINUTES;
      const spentRest = useFlipStore.getState().spendCredits(Math.min(need, restCredits));
      const spentBonus = useAttendanceStore.getState().spendBonusCredits(Math.min(need - spentRest, bonusCredits));
      const spent = spentRest + spentBonus;
      if (spent <= 0) return;
      grant(spent);
      useToastStore.getState().show(t('home.focusSessionExtendedToast', { extend: spent }));
      onDismiss();
    } finally {
      setUsingCredits(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Feather name="zap" size={22} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t(titleKey)}</Text>
        <Text style={styles.message}>{t(messageKey, { extend: FOCUS_SESSION_EXTEND_MINUTES })}</Text>
        <Pressable style={[styles.btn, styles.btnPrimary, watchingAd && styles.btnDisabled]} onPress={onWatchAd} disabled={watchingAd || usingCredits}>
          {watchingAd ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Feather name="play-circle" size={16} color="#FFFFFF" />
              <Text style={styles.btnPrimaryText}>{t('home.watchAdToExtend', { extend: FOCUS_SESSION_EXTEND_MINUTES })}</Text>
            </>
          )}
        </Pressable>
        {totalCredits >= FOCUS_SESSION_EXTEND_MINUTES && (
          <Pressable style={[styles.btn, styles.btnCredits, usingCredits && styles.btnDisabled]} onPress={onUseCredits} disabled={watchingAd || usingCredits}>
            <Feather name="star" size={16} color={colors.successLight} />
            <Text style={styles.btnCreditsText}>{t('home.useCreditsToExtend', { credits: FOCUS_SESSION_EXTEND_MINUTES, extend: FOCUS_SESSION_EXTEND_MINUTES })}</Text>
          </Pressable>
        )}
        <Pressable style={styles.dismissBtn} onPress={onDismiss} disabled={watchingAd || usingCredits}>
          <Text style={styles.dismissText}>{t('overlay.notNow')}</Text>
        </Pressable>
      </View>
    </View>
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
  card: { width: '100%', maxWidth: 340, backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, alignItems: 'center', gap: spacing.xs },
  iconWrap: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 17, fontFamily: typography.bodyFontFamilyBold, textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: spacing.sm },
  btn: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnDisabled: { opacity: 0.7 },
  btnPrimaryText: { color: '#FFFFFF', fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
  btnCredits: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' },
  btnCreditsText: { color: colors.successLight, fontFamily: typography.bodyFontFamilyBold, fontSize: 14 },
  dismissBtn: { paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: colors.textSecondary, fontFamily: typography.bodyFontFamilySemibold, fontSize: 13 },
});
