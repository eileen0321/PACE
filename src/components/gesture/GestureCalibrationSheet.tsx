// 손짓 개인 보정 시트 — 손짓을 **켤 때** 뜬다.
//
// ── 왜 필요한가 (2026-08-29) ──
// 손짓 깊이(카메라 앞을 지날 때 밝기가 얼마나 떨어지는가)는 손 크기·거리·조명에 따라 사람마다
// 크게 다르다. 그런데 지금까지는 상수 하나(3% 하락)를 전 사용자에게 똑같이 썼다. 3%는 사람이
// 앞에 있기만 해도 늘 넘는 값이라, 몸을 기울이거나 팔을 뻗는 것까지 전부 손짓이 됐다.
//   실측: 사람 있음 → 1.2초(불응시간)마다 연속 발화, 30초에 44회 / 빈 벽 → 2분간 0회
// 문턱을 조이면 이번엔 진짜 손짓도 죽는다. 그래서 값을 추측하는 대신 **본인 손짓을 잰다.**
//
// ── 이탈을 막는 설계 ──
// ⚠️ 이 화면은 "시험"이 아니라 **시연**으로 보여야 한다. 지금 앱에는 어떤 동작을 해야 하는지
//    알려주는 화면이 아예 없어서, 안내는 어차피 필요하다 — 보정은 거기에 얹는 것이라 사용자가
//    느끼는 추가 부담이 거의 없다.
// ⚠️ 매 성공마다 **즉시 반응**(링이 빛나고 점이 채워지고 햅틱)을 준다. 무반응이 이탈을 만든다.
// ⚠️ 반드시 **건너뛰기**를 둔다. 어두운 방 등으로 측정이 안 되는 경우가 반드시 생기는데,
//    거기서 막히면 그 자리에서 이탈한다. 건너뛰면 기본값으로 동작하고 나중에 설정에서 다시 한다.
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
  REQUIRED_SAMPLES,
  startCalibration,
  stopCalibration,
  type CalibrationSample,
} from '../../services/gestureCalibration';

const AnimatedView = Animated.createAnimatedComponent(View);

/** 감지될 때마다 바깥으로 퍼지는 링 — "지금 보고 있다"를 시각적으로 알린다. */
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
    <View style={styles.stage} pointerEvents="none">
      <AnimatedView style={[styles.ringOuter, outer]} />
      <AnimatedView style={[styles.ringInner, inner]} />
      <LinearGradient
        colors={['rgba(88,86,214,0.35)', 'rgba(88,86,214,0)']}
        style={styles.glow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <View style={styles.handIcon}>
        <Feather name="wind" size={30} color={colors.primary} />
      </View>
    </View>
  );
}

/** 남은 횟수 — 채워질 때 스프링으로 튀어 진행이 눈에 보이게 한다. */
function ProgressDots({ done }: { done: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: REQUIRED_SAMPLES }, (_, i) => (
        <Dot key={i} filled={i < done} />
      ))}
    </View>
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
  /** 보정 성공 — 산출된 문턱은 이미 저장된 뒤에 불린다. */
  onDone: () => void;
  /** 건너뛰기 — 기본값으로 동작한다. */
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [samples, setSamples] = useState<CalibrationSample[]>([]);
  const [phase, setPhase] = useState<'intro' | 'measuring' | 'done' | 'denied'>('intro');
  const pulse = useSharedValue(0);
  const samplesRef = useRef<CalibrationSample[]>([]);

  const flash = useCallback(() => {
    pulse.value = withSequence(
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [pulse]);

  // 시트가 닫히면 무슨 일이 있어도 카메라를 끈다 — 보정 화면을 벗어났는데 카메라가 남아 있으면
  // 배터리를 먹고, 무엇보다 사용자가 이해할 수 없는 상태가 된다.
  useEffect(() => {
    if (!visible) {
      stopCalibration().catch(() => {});
      setSamples([]);
      samplesRef.current = [];
      setPhase('intro');
    }
  }, [visible]);

  const begin = useCallback(async () => {
    samplesRef.current = [];
    setSamples([]);
    const ok = await startCalibration((s) => {
      // 표본은 ref 로도 들고 간다 — setState 는 비동기라 연속 표본에서 개수를 놓칠 수 있다.
      samplesRef.current = [...samplesRef.current, s];
      setSamples(samplesRef.current);
      flash();
      if (samplesRef.current.length >= REQUIRED_SAMPLES) {
        stopCalibration(samplesRef.current)
          .then(() => setPhase('done'))
          .catch(() => setPhase('done'));
      }
    });
    setPhase(ok ? 'measuring' : 'denied');
  }, [flash]);

  const skip = useCallback(() => {
    stopCalibration().catch(() => {});
    onSkip();
  }, [onSkip]);

  const done = samples.length;
  const lastDepth = done > 0 ? samples[done - 1].depth : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <SensorRings pulse={pulse} />

          {phase === 'intro' && (
            <>
              <Text style={styles.eyebrow}>{t('gestureCalib.eyebrow')}</Text>
              <Text style={styles.title}>{t('gestureCalib.introTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.introBody')}</Text>
            </>
          )}

          {phase === 'measuring' && (
            <>
              <Text style={styles.eyebrow}>{t('gestureCalib.eyebrow')}</Text>
              <Text style={styles.title}>{t('gestureCalib.measuringTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.measuringBody')}</Text>
              <ProgressDots done={done} />
              {/* 모노 숫자로 실측값을 보여준다 — "재고 있다"는 것이 눈에 보여야 기다린다. */}
              <Text style={styles.telemetry}>
                {done > 0
                  ? `${done}/${REQUIRED_SAMPLES}   ${(lastDepth * 100).toFixed(1)}%`
                  : t('gestureCalib.waiting')}
              </Text>
            </>
          )}

          {phase === 'done' && (
            <>
              <Text style={[styles.eyebrow, styles.eyebrowOk]}>{t('gestureCalib.doneEyebrow')}</Text>
              <Text style={styles.title}>{t('gestureCalib.doneTitle')}</Text>
              <Text style={styles.body}>{t('gestureCalib.doneBody')}</Text>
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
            {phase === 'denied' && (
              <Pressable style={styles.cta} onPress={skip}>
                <Text style={styles.ctaText}>{t('gestureCalib.useDefault')}</Text>
              </Pressable>
            )}
            {/* 건너뛰기는 항상 열어둔다 — 여기서 막히면 그 자리에서 이탈한다. */}
            {phase !== 'done' && (
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
