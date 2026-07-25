import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '../ui/GlassSurface';
import { colors, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(3) App.tsx의 "DYNAMIC LOADING SEQUENCE TRANSITION OVERLAY"를 이식
// (App.tsx:226-253, 656-708, 사용자 지시) — 플랫폼 카드 탭 → 세션 실제 시작 사이에 체크리스트
// 애니메이션(450ms 간격 스텝 증가, 완료 후 300ms 대기)을 보여준다. Android는 3단계
// (Starting Session.../Overlay ON/Opening {App}), iOS는 2단계(Starting Pace Player/Loading Feed...).
// 원본은 platform 상태를 Settings에서 수동 토글하는 웹 시뮬레이터라 마지막 스텝 문구가 항상
// "Opening YouTube Shorts"로 하드코딩돼 있었다(다른 플랫폼을 골라도 안 바뀌는 명백한 버그) —
// 이 앱은 실제 Platform.OS + 실제 3개 플랫폼을 지원하므로 그 부분만 platformFullTitle로 교정.
const STEP_INTERVAL_MS = 450;
const COMPLETE_DELAY_MS = 300;

export function ConnectingOverlay({ visible, platformName, platformFullTitle, onComplete }: {
  visible: boolean;
  platformName: string;
  platformFullTitle: string;
  onComplete: () => void;
}) {
  const isAndroid = Platform.OS === 'android';
  const steps = isAndroid
    ? [
        { n: 1, label: 'Starting Session...' },
        { n: 2, label: 'Overlay ON' },
        { n: 3, label: `Opening ${platformFullTitle}` },
      ]
    : [
        { n: 1, label: 'Starting Pace Player' },
        { n: 2, label: 'Loading Feed...' },
      ];
  const maxStep = steps.length;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!visible) {
      setStep(0);
      return;
    }
    const interval = setInterval(() => {
      setStep((prev) => (prev >= maxStep ? prev : prev + 1));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [visible, maxStep]);

  useEffect(() => {
    if (!visible || step < maxStep) return;
    const timeout = setTimeout(onComplete, COMPLETE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [visible, step, maxStep, onComplete]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent>
      <GlassSurface style={styles.backdrop} intensity={30} fallbackColor="rgba(0,0,0,0.9)">
        <View style={styles.glow} pointerEvents="none" />
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
        <Text style={styles.title}>{platformName} Selected</Text>
        <View style={styles.checklist}>
          {steps.map((item) => (
            <View key={item.n} style={styles.checkRow}>
              <Ionicons
                name="checkmark"
                size={16}
                color={step >= item.n ? colors.successLight : 'rgba(255,255,255,0.25)'}
              />
              <Text style={[styles.checkLabel, step >= item.n && styles.checkLabelActive]}>{item.label}</Text>
            </View>
          ))}
        </View>
      </GlassSurface>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  glow: { position: 'absolute', width: 256, height: 256, borderRadius: 128, backgroundColor: `${colors.primary}1A` },
  spinner: { marginBottom: spacing.md },
  title: { fontSize: 20, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: -0.3, marginBottom: spacing.lg },
  checklist: { width: 220, gap: spacing.xs, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: 'rgba(255,255,255,0.4)' },
  checkLabelActive: { color: '#E5E7EB' },
});
