import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { STORAGE_KEYS } from '../../services/storage/keys';
import { useTranslation } from '../../services/i18n';
import { capabilities } from '../../services/platform/capabilities';
import { SnapPulseIllustration } from '../../components/home/SnapPulseIllustration';
import { GestureFlickIllustration } from '../../components/home/GestureFlickIllustration';
import { RemoteClickIllustration } from '../../components/home/RemoteClickIllustration';
import { FlipPhoneHero } from '../../components/home/FlipPhoneHero';
import { colors, radius, spacing, typography } from '../../constants/theme';

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
  // 2026-07-26 사용자 지시("이 가이드가 계속 볼 수 있어야") — 이 개요 다음(2페이지)에 실제
  // 제스처 애니메이션이 있는 안내 화면이 이어진다.
  { icon: 'zap', titleKey: 'onboarding.row6Title', descKey: 'onboarding.row6Desc' },
];

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 2026-07-26 사장님 지시 — "그냥 저 가이드는 가이드로 남기고, 진짜 켜는 건 오버레이/웹뷰에서" —
  // 이 화면(개요 → 휴식 측정/Flip Mode 안내 → 핸즈프리 안내, 3페이지)은 순수 정보 제공이라 실제
  // Auto Mode 토글/프리미엄 체크가 전혀 없다. 진짜 "Turn On"은 home.tsx가 세션을 시작할 때 뜨는
  // BluetoothOnboardingSheet(오버레이 진입 직전) 하나뿐 — 여기서 같은 컴포넌트를 재사용하면 활성
  // 세션도 없는데 "켜짐" 배지를 기대하게 만드는 혼란이 생겨서(사장님이 직접 지적) 완전히 분리했다.
  const [page, setPage] = useState<0 | 1 | 2>(0);

  const finish = () => {
    AsyncStorage.setItem(STORAGE_KEYS.onboardingCompleted, 'true').catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  const onTap = () => {
    if (page === 0) setPage(1);
    else if (page === 1) setPage(2);
    else finish();
  };

  return (
    <Pressable style={styles.flex} onPress={onTap}>
      {/* 2026-07-26 사용자 지적("하단 내비게이션 바만 까맣다") — SafeAreaView로 감싸면 그 안쪽
          콘텐츠 영역만 그려지고, SafeAreaView 바깥(하단 제스처바/내비게이션 바 영역)은 이 화면의
          배경이 전혀 안 닿아 시스템 기본 검정이 그대로 드러난다. quick-control-sheet.tsx가 같은
          transparentModal edge-to-edge 문제를 고친 방식 그대로 따른다 — 배경을
          StyleSheet.absoluteFill로 화면 전체(시스템 바 영역까지)에 깔고, 콘텐츠는 insets를 직접
          패딩으로 계산해 넣는다. 2026-07-26 — Hands-Free Control 시트와 배경색을 맞추기 위해
          기존 남색→보라 그라데이션 대신 colors.card 단색으로 교체(모든 페이지가 같은 배경 공유). */}
      <View style={[StyleSheet.absoluteFill, styles.background]} />
      <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        {page === 0 ? (
          <>
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
          </>
        ) : page === 1 ? (
          <>
            <View style={styles.headerBlock}>
              <FlipPhoneHero />
              <Text style={styles.title}>{t('onboarding.row1Title')}</Text>
              <Text style={styles.subtitle}>{t('onboarding.flipCreditsDesc')}</Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.headerBlock}>
              <View style={styles.handsFreeIconWrap}>
                <Feather name="zap" size={26} color={colors.primary} />
              </View>
              <Text style={styles.title}>{t('handsFreeSheet.title')}</Text>
              <Text style={styles.subtitle}>{t('handsFreeSheet.valueLine')}</Text>
            </View>

            <View style={styles.rows}>
              {capabilities.supportsFingerSnap && (
                <View style={styles.row}>
                  <View style={styles.gestureStage}><SnapPulseIllustration /></View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{t('handsFreeSheet.fingerSnapLabel')}</Text>
                    <Text style={styles.rowDesc}>{t('handsFreeSheet.nextShort')}</Text>
                  </View>
                </View>
              )}
              <View style={styles.row}>
                <View style={styles.gestureStage}><GestureFlickIllustration /></View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{t('handsFreeSheet.handWaveLabel')}</Text>
                  <Text style={styles.rowDesc}>{t('handsFreeSheet.nextShort')}</Text>
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.gestureStage}><RemoteClickIllustration /></View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{t('handsFreeSheet.bluetoothRemoteLabel')}</Text>
                  <Text style={styles.rowDesc}>{t('handsFreeSheet.nextShort')}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.scopeNote}>{t('handsFreeSheet.scopeNote')}</Text>
          </>
        )}

        <Text style={styles.dismissLabel}>{page === 2 ? t('onboarding.tapToFinish') : t('onboarding.tapToContinue')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  background: { backgroundColor: colors.card },
  container: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center', gap: spacing.xl },
  headerBlock: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  handsFreeIconWrap: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: `${colors.primary}1A`, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  // 2026-07-26 사용자 지시 — 시선이 바로 아래 목록으로 떨어진다는 지적, 제목을 20~30% 키우고
  // 소제목은 한 줄로 줄임(22→28, 부제 문구도 짧게 교체).
  title: { fontSize: 28, fontFamily: typography.displayFontFamily, color: '#FFFFFF', letterSpacing: -0.3, textAlign: 'center' },
  subtitle: { fontSize: 13.5, lineHeight: 19, fontFamily: typography.bodyFontFamily, color: 'rgba(255,255,255,0.65)', textAlign: 'center', maxWidth: '85%', alignSelf: 'center' },
  rows: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 40, alignItems: 'center' },
  gestureStage: { width: 40, alignItems: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyBold, color: '#FFFFFF' },
  rowDesc: { fontSize: 13, lineHeight: 18, fontFamily: typography.bodyFontFamily, color: 'rgba(255,255,255,0.6)' },
  scopeNote: { fontSize: 12, lineHeight: 17, fontFamily: typography.bodyFontFamilyMedium, color: 'rgba(255,255,255,0.45)', textAlign: 'center' },
  dismissLabel: { textAlign: 'center', fontSize: 12.5, fontFamily: typography.bodyFontFamilySemibold, color: 'rgba(255,255,255,0.55)', marginTop: spacing.lg },
});
