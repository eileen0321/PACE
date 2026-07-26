import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { STORAGE_KEYS } from '../../services/storage/keys';
import { useTranslation } from '../../services/i18n';
import { BluetoothOnboardingSheet } from '../../components/home/BluetoothOnboardingSheet';
import { colors, spacing, typography } from '../../constants/theme';

// 2026-07-26 사용자 지시 — Instagram Stories 제스처 가이드 참고 이미지 그대로: 스와이프로 넘기는
// 3~4장 캐러셀이 아니라, 4개 항목을 한 화면에 전부 나열하고 화면 아무 곳이나 탭하면 닫히는 단일
// 오버레이 카드. 배경도 불투명 단색이 아니라 남색→보라 그라데이션 반투명 오버레이(_layout.tsx에서
// presentation: 'transparentModal'로 등록 — 실제로 화면 위에 얹히는 오버레이). 아이콘은 이모지
// 대신 참고 이미지처럼 흰색 단색 라인 아이콘(Feather)으로 통일 — 사용자가 이모지 조합을 "촌스럽다"고
// 지적함.
type RowTitleKey = 'onboarding.row1Title' | 'onboarding.row2Title' | 'onboarding.row3Title' | 'onboarding.row4Title' | 'onboarding.row5Title' | 'onboarding.row6Title';
type RowDescKey = 'onboarding.row1Desc' | 'onboarding.row2Desc' | 'onboarding.row3Desc' | 'onboarding.row4Desc' | 'onboarding.row5Desc' | 'onboarding.row6Desc';
const ROWS: { icon: keyof typeof Feather.glyphMap; titleKey: RowTitleKey; descKey: RowDescKey }[] = [
  // 2026-07-26 사용자 지적 — "휴식 측정"은 폰을 아무렇게나 내려놓는 게 아니라 정확히 뒤집어서(화면이
  // 바닥을 향하게) 놔야 기록되는 Flip Mode(useFlipStore.onFaceDown, 가속도계 기반 방향 감지)다.
  // Feather에 "뒤집힌 폰" 전용 아이콘은 없어 스마트폰 아이콘(smartphone)으로 대체 — 정확한 방향
  // 설명은 아이콘이 아니라 아래 문구(row1Desc)가 맡는다.
  { icon: 'smartphone', titleKey: 'onboarding.row1Title', descKey: 'onboarding.row1Desc' },
  { icon: 'star', titleKey: 'onboarding.row2Title', descKey: 'onboarding.row2Desc' },
  // 2026-07-26 사용자 지시 — 심사 관점에서 "연속 시청"을 온보딩 전면에 내세우는 대신(Copilot 조언
  // 반영), 사용 통계 확인으로 대체. 크레딧으로 시청을 이어가는 기능 자체는 그대로 있고, 한도 도달
  // 모달에서 자연스럽게 발견하게 둔다(overlay/index.tsx의 capModal 참고) — 온보딩에서 굳이 홍보하지
  // 않음.
  { icon: 'bar-chart-2', titleKey: 'onboarding.row3Title', descKey: 'onboarding.row3Desc' },
  { icon: 'moon', titleKey: 'onboarding.row4Title', descKey: 'onboarding.row4Desc' },
  // 2026-07-26 사용자 지시("매일 출석하기") — useAttendanceStore.checkInIfNeeded() 실제 기능 소개.
  { icon: 'calendar', titleKey: 'onboarding.row5Title', descKey: 'onboarding.row5Desc' },
  // 2026-07-26 사용자 지시("이 가이드가 계속 볼 수 있어야") — 이 개요 다음에 실제 Hands-Free
  // Control 시트(제스처 애니메이션 포함)가 이어서 뜬다(아래 참고). 개요 목록에도 존재를 알린다.
  { icon: 'zap', titleKey: 'onboarding.row6Title', descKey: 'onboarding.row6Desc' },
];

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 2026-07-26 사용자 지시 — Settings "Replay Feature Guide"로 이 화면을 다시 볼 때, 실제 손짓
  // 가이드(BluetoothOnboardingSheet, 애니메이션 포함)를 처음 한 번만 보고 다시는 못 보는 문제가
  // 있었다 — 이 개요 화면을 탭해서 닫으면 바로 이어서 그 시트를 보여줘 언제든 다시 확인 가능하게 한다.
  const [showHandsFree, setShowHandsFree] = useState(false);

  const finish = () => {
    AsyncStorage.setItem(STORAGE_KEYS.onboardingCompleted, 'true').catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  // 이 화면 자체에는 세션/플랫폼 컨텍스트가 없어(홈 화면의 dismissOnboarding과 달리 세션을 막
  // 시작하는 상황이 아님) "Turn On"은 다음 세션부터 자동으로 켜지도록 옵트인만 저장하고, 지금
  // 당장 네이티브 감지기(카메라/마이크)를 켜지는 않는다 — 세션도 없는데 상시 감지가 도는 걸 방지.
  const handleHandsFreeEnable = () => {
    AsyncStorage.setItem(STORAGE_KEYS.autoModeOptIn, 'true').catch(() => {});
    setShowHandsFree(false);
    finish();
  };
  const handleHandsFreeDismiss = () => {
    setShowHandsFree(false);
    finish();
  };

  return (
    <>
      <Pressable style={styles.flex} onPress={() => setShowHandsFree(true)}>
        {/* 2026-07-26 사용자 지시 — 이 화면 배경을 Hands-Free Control 온보딩 시트와 같은 색으로
            맞춘다(기존 남색→보라 그라데이션 대신 colors.card 단색). */}
        <View style={[StyleSheet.absoluteFill, styles.background]} />
        <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.headerBlock}>
            <Text style={styles.title}>{t('onboarding.overlayTitle')}</Text>
            <Text style={styles.subtitle}>{t('onboarding.overlaySubtitle')}</Text>
          </View>

          <View style={styles.rows}>
            {ROWS.map((row) => (
              <View key={row.icon} style={styles.row}>
                <View style={styles.iconWrap}>
                  <Feather name={row.icon} size={22} color="#FFFFFF" />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{t(row.titleKey)}</Text>
                  <Text style={styles.rowDesc}>{t(row.descKey)}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.dismissLabel}>{t('onboarding.tapToContinue')}</Text>
        </View>
      </Pressable>
      <BluetoothOnboardingSheet visible={showHandsFree} onEnable={handleHandsFreeEnable} onDismiss={handleHandsFreeDismiss} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 2026-07-26 — Hands-Free Control 온보딩 시트(colors.card)와 배경색을 맞췄다. 원래 남색→보라
  // 그라데이션(rgba(30,41,80)→rgba(76,29,135))이었던 걸 이 화면 뒤에 바로 이어지는 시트와 톤이
  // 통일되도록 단색으로 교체.
  background: { backgroundColor: colors.card },
  container: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center', gap: spacing.xl },
  headerBlock: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  // 2026-07-26 사용자 지시 — 시선이 바로 아래 목록으로 떨어진다는 지적, 제목을 20~30% 키우고
  // 소제목은 한 줄로 줄임(22→28, 부제 문구도 짧게 교체).
  title: { fontSize: 28, fontFamily: typography.displayFontFamily, color: '#FFFFFF', letterSpacing: -0.3, textAlign: 'center' },
  subtitle: { fontSize: 13.5, lineHeight: 19, fontFamily: typography.bodyFontFamily, color: 'rgba(255,255,255,0.65)', textAlign: 'center', maxWidth: '85%', alignSelf: 'center' },
  rows: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 40, alignItems: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyBold, color: '#FFFFFF' },
  rowDesc: { fontSize: 13, lineHeight: 18, fontFamily: typography.bodyFontFamily, color: 'rgba(255,255,255,0.6)' },
  dismissLabel: { textAlign: 'center', fontSize: 12.5, fontFamily: typography.bodyFontFamilySemibold, color: 'rgba(255,255,255,0.55)', marginTop: spacing.lg },
});
