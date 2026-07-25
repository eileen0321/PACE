import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';

// 2026-07-22 사용자 지시 — 하루 한도를 넘긴 뒤 반복적으로 뜨던 단일 다이얼로그를 3단계로 완화.
// 실제 스크린타임 앱 UX 리서치 결과(One Sec/Apple Screen Time 등) — 반복될수록 마찰을 "키우기"보다
// "줄이는" 쪽이 표준이다(계속 풀 다이얼로그로 막으면 그냥 무시하게 되는 알림 피로 문제). 그래서:
//   1차(정확히 한도 도달): 풀 다이얼로그 + [5분 추가]/[오늘은 여기까지]
//   2차(1차로부터 +5분 더 시청): 완화된 다이얼로그 + [계속 보기]/[여기까지 보기](둘 다 같은 선택지지만
//      톤을 낮춤 — "계속 보기"도 1차와 동일하게 +5분을 조용히 더 준다, 매 5분마다 재확인하는 셈)
//   3차 이상: 선택지 없이 1~3초 자동 소멸하는 담백한 안내만(차단 아님, 그냥 알려주기만).
// 접근성(WCAG 2.2.1 Timing Adjustable) — 스크린리더 사용자에게 자동 소멸 메시지가 뜨자마자 사라지면
// 정보 자체를 놓친다. `AccessibilityInfo.isScreenReaderEnabled()`로 감지해 스크린리더가 켜져 있으면
// 자동 소멸시키지 않고 탭해서 닫는 방식으로 전환 + `announceForAccessibility`로 즉시 음성 안내.
const TIER3_MESSAGES = (usageMinutes: number, goalMinutes: number) => [
  { title: 'Take your pace.', body: `지금까지 ${usageMinutes}분 시청했습니다.` },
  { title: '잠시 쉬어갈까요?', body: `오늘 ${usageMinutes}분 시청했습니다.` },
  { title: 'Time well spent.', body: '오늘 목표 시간을 초과했습니다.' },
  { title: '오늘 다른 할일이 있었나요?', body: `목표 ${goalMinutes}분을 넘겼어요.` },
];

function Tier3Toast({ visible, usageMinutes, goalMinutes, hitCount, onDone }: {
  visible: boolean;
  usageMinutes: number;
  goalMinutes: number;
  hitCount: number;
  onDone: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [screenReaderOn, setScreenReaderOn] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderOn).catch(() => {});
  }, []);

  useEffect(() => {
    if (!visible) return;
    const messages = TIER3_MESSAGES(usageMinutes, goalMinutes);
    const msg = messages[(hitCount - 3) % messages.length];
    AccessibilityInfo.announceForAccessibility(`${msg.title} ${msg.body}`);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    if (screenReaderOn) return; // 스크린리더 사용자는 탭해서 직접 닫음 — 자동 소멸 안 함.
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(onDone);
    }, 2200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, screenReaderOn]);

  if (!visible) return null;
  const messages = TIER3_MESSAGES(usageMinutes, goalMinutes);
  const msg = messages[(hitCount - 3) % messages.length];

  return (
    <Animated.View
      style={[styles.tier3Wrap, { opacity }]}
      pointerEvents={screenReaderOn ? 'auto' : 'none'}
      accessible
      accessibilityRole={screenReaderOn ? 'button' : undefined}
      accessibilityLabel={`${msg.title} ${msg.body}`}
    >
      <Pressable
        style={styles.tier3Pill}
        onPress={screenReaderOn ? onDone : undefined}
        disabled={!screenReaderOn}
      >
        <Text style={styles.tier3Title}>{msg.title}</Text>
        <Text style={styles.tier3Body}>{msg.body}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function LimitReachedOverlay({ visible, tier, hitCount, limitMinutes, todayUsageMinutes, onExtend, onDismiss }: {
  visible: boolean;
  tier: 1 | 2 | 3;
  hitCount: number;
  limitMinutes: number;
  todayUsageMinutes: number;
  onExtend: () => void;
  onDismiss: () => void;
}) {
  if (tier === 3) {
    return (
      <Tier3Toast visible={visible} usageMinutes={todayUsageMinutes} goalMinutes={limitMinutes} hitCount={hitCount} onDone={onDismiss} />
    );
  }

  const isTier1 = tier === 1;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.spacer} />
        <View style={styles.centerBlock}>
          <View style={styles.iconWrap}>
            <Feather name={isTier1 ? 'shield' : 'coffee'} size={28} color={isTier1 ? colors.dangerLight : colors.warning} />
          </View>
          {isTier1 ? (
            <>
              <Text style={styles.title}>TAKE YOUR PACE</Text>
              <Text style={styles.subtitle}>{limitMinutes}분 시청 완료</Text>
              <Text style={styles.body}>계속 시청할 수도, 여기서 멈출 수도 있습니다.</Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>잠시 쉬어갈까요?</Text>
              <Text style={styles.subtitle}>벌써 {Math.max(0, todayUsageMinutes - limitMinutes)}분이 지났습니다</Text>
            </>
          )}
        </View>
        <View style={styles.buttonBlock}>
          <Pressable onPress={onExtend} style={styles.extendBtn}>
            <Text style={styles.extendBtnText}>{isTier1 ? '5분 추가' : '계속 보기'}</Text>
          </Pressable>
          <Pressable onPress={onDismiss} style={styles.dismissBtn}>
            <Text style={styles.dismissBtnText}>{isTier1 ? '오늘은 여기까지' : '여기까지 보기'}</Text>
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
  title: { fontSize: 26, fontFamily: typography.displayFontFamily, color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center' },
  subtitle: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
  body: { fontSize: 14, fontFamily: typography.bodyFontFamilyMedium, color: '#D1D5DB', textAlign: 'center', lineHeight: 21, maxWidth: 300, marginTop: spacing.lg },
  bold: { fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF' },
  buttonBlock: { gap: spacing.sm, width: '100%', maxWidth: 320, alignSelf: 'center' },
  extendBtn: { width: '100%', paddingVertical: spacing.md, backgroundColor: colors.primary, borderRadius: radius.pill, alignItems: 'center' },
  extendBtnText: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF' },
  dismissBtn: { width: '100%', paddingVertical: spacing.sm + 4, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, alignItems: 'center' },
  dismissBtnText: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF' },

  tier3Wrap: { position: 'absolute', left: 0, right: 0, bottom: 120, alignItems: 'center', zIndex: 999 },
  tier3Pill: { backgroundColor: 'rgba(20,20,24,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: radius.card, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, maxWidth: 320, alignItems: 'center' },
  tier3Title: { fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', textAlign: 'center' },
  tier3Body: { fontSize: 11, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
});
