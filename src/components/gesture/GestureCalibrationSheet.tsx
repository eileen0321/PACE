// 손짓 개인 보정 시트 — 손짓을 **켤 때** 뜬다.
//
// ── 왜 필요한가 (2026-08-29 실측) ──
// 손짓 깊이(카메라 앞을 지날 때 밝기가 얼마나 떨어지는가)는 손 크기·거리·조명에 따라 사람마다
// 크게 다르다. 그런데 상수 하나(3% 하락)를 전 사용자에게 똑같이 썼다. 실기기로 재보니
// **가만히 있을 때의 잡음만으로 1.0~3.4%**가 나온다 — 문턱이 잡음 분포 한가운데 있었던 것이다.
// 그래서 사람이 앞에 있기만 하면 불응시간(1.2초)마다 계속 터졌다(30초에 44회, 빈 벽에서는 0회).
// 문턱을 조이면 이번엔 진짜 손짓이 죽는다. 값을 추측하는 대신 **본인 손짓을 잰다.**
//
// ── UI 원칙 (2026-08-29 리서치) ──
// "불확실성이 대기를 길게 느끼게 한다. 카운트다운과 진행 표시가 그 불안을 없앤다."
// 첫 구현에는 남은 초도 카운트도 안 보여서, 잡음이 순식간에 표본을 채우고 "완료"만 떴다 —
// 사용자는 손을 들기도 전에 끝난 것을 알 수 없었다(사장님 지적). 그래서:
//   ① 시작 전에 **무엇을 얼마나 할지** 먼저 말한다(N초 정지 → 손 M번).
//   ② 정지 구간은 **큰 숫자로 카운트다운**한다.
//   ③ 손짓 구간은 **0/5 를 크게** 보여주고, 인식될 때마다 링이 빛나고 햅틱이 온다.
//   ④ 한동안 아무것도 안 잡히면 **원인을 짚어준다**(카메라가 사용자를 안 향한 경우가 대부분).
//   ⑤ 건너뛰기는 항상 열어둔다 — 어두운 방 등으로 측정이 안 되는 경우가 반드시 생기는데,
//      거기서 막히면 그 자리에서 이탈한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useTranslation } from '../../services/i18n';
import {
  NOISE_PHASE_MS,
  REQUIRED_SAMPLES,
  isGestureDepth,
  noiseFloor,
  startCalibration,
  stopCalibration,
  type CalibrationSample,
} from '../../services/gestureCalibration';

const AnimatedView = Animated.createAnimatedComponent(View);

/** 이 시간 동안 손짓이 하나도 안 잡히면 원인을 짚어준다. */
const STALL_HINT_MS = 12000;
/** 연속 표본을 한 번의 손짓으로 묶는 간격. 잡음 3개를 3회로 세지 않기 위한 것. */
const MIN_GAP_MS = 700;

type Phase = 'intro' | 'noise' | 'measuring' | 'done' | 'unusable' | 'denied';

function SensorRings({ pulse }: { pulse: SharedValue<number> }) {
  const idle = useSharedValue(0);
  useEffect(() => {
    idle.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(idle);
  }, [idle]);

  const outer = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + idle.value * 0.06 + pulse.value * 0.22 }],
    opacity: 0.18 + idle.value * 0.1 + pulse.value * 0.5,
  }));
  const inner = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.12 }],
    opacity: 0.5 + pulse.value * 0.5,
  }));

  return (
    <>
      <AnimatedView style={[styles.ringOuter, outer]} />
      <AnimatedView style={[styles.ringInner, inner]} />
      <LinearGradient
        colors={['rgba(88,86,214,0.35)', 'rgba(88,86,214,0)']}
        style={styles.glow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
    </>
  );
}

function Dot({ filled }: { filled: boolean }) {
  const s = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    s.value = withSpring(filled ? 1 : 0, { damping: 9, stiffness: 220 });
  }, [filled, s]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.8 + s.value * 0.35 }],
    backgroundColor: s.value > 0.5 ? colors.primary : 'rgba(255,255,255,0.12)',
  }));
  return <AnimatedView style={[styles.dot, style]} />;
}

export function GestureCalibrationSheet({
  visible,
  onDone,
  onSkip,
}: {
  visible: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('intro');
  const [count, setCount] = useState(0);
  const [countdown, setCountdown] = useState(Math.round(NOISE_PHASE_MS / 1000));
  const [savedRatio, setSavedRatio] = useState<number | null>(null);
  const [stalled, setStalled] = useState(false);
  const pulse = useSharedValue(0);

  // 콜백은 네이티브 이벤트로 자주 불린다 — state 는 비동기라 개수를 놓친다. ref 로 센다.
  const phaseRef = useRef<Phase>('intro');
  const gesturesRef = useRef<CalibrationSample[]>([]);
  const noiseRef = useRef<CalibrationSample[]>([]);
  const floorRef = useRef(0);
  const lastAtRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const flash = useCallback(() => {
    pulse.value = withSequence(
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [pulse]);

  const reset = useCallback(() => {
    clearTimers();
    phaseRef.current = 'intro';
    gesturesRef.current = [];
    noiseRef.current = [];
    floorRef.current = 0;
    lastAtRef.current = 0;
    setPhase('intro');
    setCount(0);
    setCountdown(Math.round(NOISE_PHASE_MS / 1000));
    setSavedRatio(null);
    setStalled(false);
  }, [clearTimers]);

  // 시트를 벗어나면 무슨 일이 있어도 카메라를 끈다.
  useEffect(() => {
    if (!visible) {
      stopCalibration().catch(() => {});
      reset();
    }
    return () => clearTimers();
  }, [visible, reset, clearTimers]);

  const begin = useCallback(async () => {
    reset();
    phaseRef.current = 'noise';

    const ok = await startCalibration((sample) => {
      // 1단계: 가만히 있는 동안의 잡음 — 손짓 문턱의 바닥이 된다.
      if (phaseRef.current === 'noise') {
        noiseRef.current = [...noiseRef.current, sample];
        return;
      }
      if (phaseRef.current !== 'measuring') return;
      // 2단계: 잡음보다 확실히 깊은 것만 1회로 센다.
      if (!isGestureDepth(sample.depth, floorRef.current)) return;
      const now = Date.now();
      if (now - lastAtRef.current < MIN_GAP_MS) return;
      lastAtRef.current = now;
      gesturesRef.current = [...gesturesRef.current, sample];
      setCount(gesturesRef.current.length);
      setStalled(false);
      flash();
      if (gesturesRef.current.length >= REQUIRED_SAMPLES) {
        phaseRef.current = 'done';
        clearTimers();
        stopCalibration(gesturesRef.current, floorRef.current)
          .then((saved) => {
            setSavedRatio(saved);
            setPhase(saved == null ? 'unusable' : 'done');
          })
          .catch(() => setPhase('unusable'));
      }
    });

    if (!ok) {
      phaseRef.current = 'denied';
      setPhase('denied');
      return;
    }
    setPhase('noise');

    // 남은 초를 실제로 보여준다 — 얼마나 기다려야 하는지 모르는 것이 가장 나쁘다.
    const total = Math.round(NOISE_PHASE_MS / 1000);
    for (let i = 1; i <= total; i++) {
      timersRef.current.push(setTimeout(() => setCountdown(total - i), i * 1000));
    }
    timersRef.current.push(
      setTimeout(() => {
        floorRef.current = noiseFloor(noiseRef.current);
        phaseRef.current = 'measuring';
        lastAtRef.current = Date.now();
        setPhase('measuring');
        // 한참 아무것도 안 잡히면 원인을 짚어준다(대부분 카메라가 사용자를 안 향한다).
        timersRef.current.push(
          setTimeout(() => {
            if (gesturesRef.current.length === 0) setStalled(true);
          }, STALL_HINT_MS)
        );
      }, NOISE_PHASE_MS)
    );
  }, [reset, flash, clearTimers]);

  const skip = useCallback(() => {
    stopCalibration().catch(() => {});
    onSkip();
  }, [onSkip]);

  const centerIcon =
    phase === 'done' ? 'check' : phase === 'unusable' || phase === 'denied' ? 'alert-circle' : 'wind';
  const centerColor =
    phase === 'done' ? colors.successLight : phase === 'intro' ? colors.primary : colors.warning;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.stage} pointerEvents="none">
            <SensorRings pulse={pulse} />
            {/* 링 한가운데는 지금 무엇을 해야 하는지에 따라 바뀐다 — 숫자가 곧 안내다. */}
            {phase === 'noise' ? (
              <Text style={styles.bigNumber}>{countdown}</Text>
            ) : phase === 'measuring' ? (
              <Text style={styles.bigNumber}>
                {count}
                <Text style={styles.bigNumberDim}>/{REQUIRED_SAMPLES}</Text>
              </Text>
            ) : (
              <View style={styles.handIcon}>
                <Feather name={centerIcon} size={30} color={centerColor} />
              </View>
            )}
          </View>

          {phase === 'intro' && (
            <>
              <Text style={styles.eyebrow}>{t('gestureCalib.eyebrow')}</Text>
              <Text style={styles.title}>{t('gestureCalib.introTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.introBody')}</Text>
              {/* 시작 전에 무엇을 얼마나 할지 먼저 말한다. */}
              <View style={styles.steps}>
                <Text style={styles.step}>
                  {t('gestureCalib.step1', { sec: Math.round(NOISE_PHASE_MS / 1000) })}
                </Text>
                <Text style={styles.step}>{t('gestureCalib.step2', { n: REQUIRED_SAMPLES })}</Text>
              </View>
            </>
          )}

          {phase === 'noise' && (
            <>
              <Text style={styles.eyebrow}>{t('gestureCalib.step1of2')}</Text>
              <Text style={styles.title}>{t('gestureCalib.noiseTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.noiseBody')}</Text>
            </>
          )}

          {phase === 'measuring' && (
            <>
              <Text style={styles.eyebrow}>{t('gestureCalib.step2of2')}</Text>
              <Text style={styles.title}>{t('gestureCalib.measuringTitle')}</Text>
              <Text style={styles.body}>
                {stalled ? t('gestureCalib.stallHint') : t('gestureCalib.measuringBody')}
              </Text>
              <View style={styles.dots}>
                {Array.from({ length: REQUIRED_SAMPLES }, (_, i) => (
                  <Dot key={i} filled={i < count} />
                ))}
              </View>
            </>
          )}

          {phase === 'done' && (
            <>
              <Text style={[styles.eyebrow, styles.eyebrowOk]}>{t('gestureCalib.doneEyebrow')}</Text>
              <Text style={styles.title}>{t('gestureCalib.doneTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.doneBody')}</Text>
              {/* 무엇이 저장됐는지 숫자로 보여준다 — "완료"만으로는 무엇을 했는지 알 수 없다. */}
              {savedRatio != null && (
                <Text style={styles.telemetry}>
                  {t('gestureCalib.savedLabel')}  {((1 - savedRatio) * 100).toFixed(1)}%
                </Text>
              )}
            </>
          )}

          {phase === 'unusable' && (
            <>
              <Text style={[styles.eyebrow, styles.eyebrowWarn]}>{t('gestureCalib.unusableEyebrow')}</Text>
              <Text style={styles.title}>{t('gestureCalib.unusableTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.unusableBody')}</Text>
            </>
          )}

          {phase === 'denied' && (
            <>
              <Text style={[styles.eyebrow, styles.eyebrowWarn]}>{t('gestureCalib.deniedEyebrow')}</Text>
              <Text style={styles.title}>{t('gestureCalib.deniedTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.deniedBody')}</Text>
            </>
          )}

          <View style={styles.actions}>
            {phase === 'intro' && (
              <Pressable style={styles.cta} onPress={begin}>
                <Text style={styles.ctaText}>{t('gestureCalib.start')}</Text>
              </Pressable>
            )}
            {phase === 'done' && (
              <Pressable style={styles.cta} onPress={onDone}>
                <Text style={styles.ctaText}>{t('gestureCalib.finish')}</Text>
              </Pressable>
            )}
            {(phase === 'unusable' || phase === 'denied') && (
              <>
                <Pressable style={styles.cta} onPress={begin}>
                  <Text style={styles.ctaText}>{t('gestureCalib.retry')}</Text>
                </Pressable>
                <Pressable style={styles.skip} onPress={skip} hitSlop={12}>
                  <Text style={styles.skipText}>{t('gestureCalib.useDefault')}</Text>
                </Pressable>
              </>
            )}
            {(phase === 'intro' || phase === 'noise' || phase === 'measuring') && (
              <Pressable style={styles.skip} onPress={skip} hitSlop={12}>
                <Text style={styles.skipText}>{t('gestureCalib.skip')}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const RING = 168;
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.86)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.cardLarge,
    borderTopRightRadius: radius.cardLarge,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl + spacing.md : spacing.xl,
    alignItems: 'center',
  },
  stage: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  ringOuter: {
    position: 'absolute', width: RING, height: RING, borderRadius: RING / 2,
    borderWidth: 1, borderColor: colors.primary,
  },
  ringInner: {
    position: 'absolute', width: RING * 0.62, height: RING * 0.62, borderRadius: RING,
    borderWidth: 1.5, borderColor: colors.primary, opacity: 0.5,
  },
  glow: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, opacity: 0.5 },
  handIcon: {
    width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(88,86,214,0.14)',
  },
  bigNumber: {
    fontFamily: typography.monoFontFamilyBold, fontSize: 46, color: colors.textPrimary,
    includeFontPadding: false,
  },
  bigNumberDim: { fontSize: 24, color: colors.textTertiary },
  eyebrow: {
    fontFamily: typography.monoFontFamily, fontSize: 11, letterSpacing: 1.6,
    color: colors.textTertiary, textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  eyebrowOk: { color: colors.successLight },
  eyebrowWarn: { color: colors.warning },
  title: {
    fontFamily: typography.displayFontFamilyBold, fontSize: 24, color: colors.textPrimary,
    textAlign: 'center', marginBottom: spacing.sm,
  },
  body: {
    fontFamily: typography.bodyFontFamily, fontSize: 14, lineHeight: 21,
    color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.sm,
  },
  steps: { marginTop: spacing.lg, gap: spacing.xs, alignSelf: 'stretch' },
  step: {
    fontFamily: typography.bodyFontFamily, fontSize: 13, color: colors.textSecondary,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.chip,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  dots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  dot: { width: 10, height: 10, borderRadius: 5 },
  telemetry: {
    fontFamily: typography.monoFontFamily, fontSize: 12, letterSpacing: 1.2,
    color: colors.textTertiary, marginTop: spacing.md,
  },
  actions: { width: '100%', marginTop: spacing.xl, alignItems: 'center' },
  cta: {
    width: '100%', backgroundColor: colors.primary, borderRadius: radius.button,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  ctaText: { fontFamily: typography.bodyFontFamilySemibold, fontSize: 15, color: colors.textPrimary },
  skip: { marginTop: spacing.md, paddingVertical: spacing.xs },
  skipText: { fontFamily: typography.bodyFontFamily, fontSize: 13, color: colors.textTertiary },
});
