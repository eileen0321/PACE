import { useEffect, useState } from 'react';
import { AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useUserStore } from '../../store/useUserStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { useToastStore } from '../../store/useToastStore';
import { useTranslation } from '../../services/i18n';
import { notifyAccessibilityNeeded } from '../../services/notifications';
import { overlayService, autoNextService, capabilities } from '../../services/platform';
import { AppHeader } from '../../components/ui/AppHeader';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { AccessibilityOnboardingSheet } from '../../components/onboarding/AccessibilityOnboardingSheet';
import { bottomSheetPadding, colors, layout, radius, spacing, typography } from '../../constants/theme';

// healthy-shorts-assistant(2) SettingsSection.tsx(Focus 탭)를 토씨 하나 안 틀리고 그대로 이식
// (사용자 명시적 지시) — Session Control Hero(그라데이션+Live Engine뱃지) → Session Status card →
// Android Guard Services(플랫폼 조건부) → Pause/End 버튼 → Extend Time칩 → Interventions(Break
// Reminder/Healthy Pause + Demo 모달) → Session Stats 3그리드 → Finish Session 확인 모달.
// 원본은 minutesWatched/videosWatched를 로컬 데모 state로 관리하고 Session Stats도 18/37m/22s
// 하드코딩 목업이었는데, Pace는 실제 useStatsStore(todayUsageMinutes/todayVideosWatched/
// todayAverageDurationSeconds) 데이터로 대체했다 — "죽은 코드/가짜 데이터로 남기지 말라"는
// 별도 지시에 따름. Break Reminder/Healthy Pause 토글도 실제 useSettingsStore에 연결.
export default function FocusScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const { settings, update } = useSettingsStore();
  const { todayUsageMinutes, todayVideosWatched, todayAverageDurationSeconds, refresh } = useStatsStore();
  const { extraMinutes: bonusMinutes, addMinutes: addBonusMinutes, resetToday: resetBonusToday } = useDailyBonusStore();
  const [showPromptDemo, setShowPromptDemo] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [hasOverlayPermission, setHasOverlayPermission] = useState(false);
  const [hasUsageAccessPermission, setHasUsageAccessPermission] = useState(false);
  const [hasAutoNextPermission, setHasAutoNextPermission] = useState(false);
  const [showAccessibilityOnboarding, setShowAccessibilityOnboarding] = useState(false);
  const bluetooth = useBluetoothStore();

  useEffect(() => {
    if (user?.id) refresh(user.id);
    bluetooth.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refresh]);

  // 실제 권한 부여 상태를 조회 — 이전엔 "연결됨"/"실행 중"이 하드코딩돼 있어 권한이 없어도 항상
  // 정상으로 표시되는 실버그였다(2026-07-18 실기기 검증 중 발견). 마운트 시 1회 + AppState 'active'
  // (설정 화면에서 돌아올 때마다) 재조회해서 반영한다 — 2026-07-19: 주석은 이미 "화면 포커스마다
  // 재조회"라고 적혀 있었지만 실제 코드는 마운트 1회뿐이었던 문서/코드 불일치를 여기서 같이 바로잡음.
  // Accessibility 권한이 방금 켜졌으면(showAccessibilityOnboarding이 대기 중이던 경우) 토스트로 확인.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const [overlay, usageAccess, autoNextPermission] = await Promise.all([
        overlayService.hasOverlayPermission(),
        overlayService.hasForegroundDetectionPermission(),
        capabilities.supportsAutoNext ? autoNextService.hasPermission() : Promise.resolve(false),
      ]);
      if (cancelled) return;
      setHasOverlayPermission(overlay);
      setHasUsageAccessPermission(usageAccess);
      if (autoNextPermission && !hasAutoNextPermission && showAccessibilityOnboarding) {
        setShowAccessibilityOnboarding(false);
        useToastStore.getState().show('✅ Hands-Free Shorts Enabled');
      }
      setHasAutoNextPermission(autoNextPermission);
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => { cancelled = true; sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAccessibilityOnboarding]);

  // 2026-07-18 버그 수정: Extend Time(+10/20/30m)이 예전엔 settings.dailyLimitMinutes를 직접 올려버려서
  // "오늘만" 늘려주려던 의도와 달리 다음날 이후에도 영구히 늘어난 한도가 유지됐다. 이제 오늘 하루치
  // 보너스(useDailyBonusStore, 날짜 바뀌면 자동 리셋)를 더해서만 계산 — 영속 설정 자체는 안 건드린다.
  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;
  const remainingMinutes = Math.max(0, effectiveDailyLimitMinutes - todayUsageMinutes);
  const progressPct = Math.min(100, (todayUsageMinutes / Math.max(1, effectiveDailyLimitMinutes)) * 100);

  const extendSession = (amount: number) => addBonusMinutes(amount);
  const confirmFinish = () => { setShowFinishConfirm(false); resetBonusToday(); };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 1. Session Control Hero */}
        <LinearGradient colors={['#1A1D26', colors.cardDeep]} style={styles.heroCard}>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveTagText}>{t('focus.liveEngine')}</Text>
          </View>
          <Text style={styles.heroLabel}>{t('focus.focusSession')}</Text>
          <Text style={styles.heroTitle}>YouTube Shorts</Text>

          <View style={styles.splitRow}>
            <View style={styles.splitCol}>
              <Text style={styles.splitLabel}>{t('focus.watched')}</Text>
              <Text style={styles.splitValue}>{todayUsageMinutes}m</Text>
            </View>
            <View style={[styles.splitCol, styles.splitColRight]}>
              <Text style={styles.splitLabel}>{t('focus.remaining')}</Text>
              <Text style={[styles.splitValue, styles.splitValuePrimary]}>{remainingMinutes}m</Text>
            </View>
          </View>

          <View style={styles.heroTrack}>
            <View style={[styles.heroFill, { width: `${progressPct}%` }]} />
          </View>
        </LinearGradient>

        {/* 2. Session Status */}
        <View>
          <Text style={styles.sectionLabel}>{t('focus.sessionStatus')}</Text>
          <GlassSurface style={styles.card} intensity={20}>
            <View style={styles.statusTopRow}>
              <Text style={styles.statusTitle}>{t('focus.sessionActive')}</Text>
              <View style={styles.pulsePill}>
                <View style={styles.pulseDot} />
                <Text style={styles.pulsePillText}>{settings.autoNext ? t('focus.on') : t('focus.off')}</Text>
              </View>
            </View>
            <View style={[styles.statusRow, styles.statusRowBordered]}>
              <Text style={styles.statusRowLabel}>{t('focus.remainingTime')}</Text>
              <Text style={styles.statusRowValueMono}>{remainingMinutes}m {t('focus.remaining')}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusRowLabel}>{t('focus.sleepTimer')}</Text>
              <Text style={styles.statusRowValueMonoPrimary}>{settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : t('focus.disabled')}</Text>
            </View>
          </GlassSurface>
        </View>

        {/* 2.5 Android Guard Services (Android 전용, iOS는 원본대로 렌더 안 함) */}
        {Platform.OS === 'android' && (
          <View>
            <Text style={styles.sectionLabel}>{t('focus.androidGuardServices')}</Text>
            <View style={styles.card}>
              <Pressable style={styles.guardRow} onPress={() => !hasOverlayPermission && overlayService.requestOverlayPermission()}>
                <View style={styles.guardLeft}>
                  <Text style={styles.statusTitleSm}>{t('focus.overlayStatus')}</Text>
                  <Text style={styles.guardDesc}>{t('focus.overlayStatusDesc')}</Text>
                </View>
                <View style={[styles.pulsePill, !hasOverlayPermission && styles.pulsePillWarning]}>
                  <View style={[styles.pulseDot, !hasOverlayPermission && styles.pulseDotWarning]} />
                  <Text style={[styles.pulsePillText, !hasOverlayPermission && styles.pulsePillTextWarning]}>
                    {hasOverlayPermission ? t('focus.connected') : t('focus.notConnected')}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                style={[styles.guardRow, styles.guardRowBordered]}
                onPress={() => !hasUsageAccessPermission && overlayService.requestForegroundDetectionPermission()}
              >
                <View style={styles.guardLeft}>
                  <Text style={styles.statusTitleSm}>{t('focus.accessibilityStatus')}</Text>
                  <Text style={styles.guardDesc}>{t('focus.accessibilityStatusDesc')}</Text>
                </View>
                <View style={[styles.pulsePill, !hasUsageAccessPermission && styles.pulsePillWarning]}>
                  <View style={[styles.pulseDot, !hasUsageAccessPermission && styles.pulseDotWarning]} />
                  <Text style={[styles.pulsePillText, !hasUsageAccessPermission && styles.pulsePillTextWarning]}>
                    {hasUsageAccessPermission ? t('focus.running') : t('focus.permissionNeeded')}
                  </Text>
                </View>
              </Pressable>
              {/* Auto Next 실제 스와이프 — EXPO_PUBLIC_ENABLE_AUTO_NEXT=true 빌드에서만 노출(2026-07-18,
                  Play 스토어 정책 결정 전까지 스토어 빌드에서는 항상 숨김). */}
              {capabilities.supportsAutoNext && (
                <Pressable
                  style={[styles.guardRow, styles.guardRowBordered]}
                  onPress={() => {
                    if (hasAutoNextPermission) return;
                    setShowAccessibilityOnboarding(true);
                    notifyAccessibilityNeeded().catch(() => {});
                  }}
                >
                  <View style={styles.guardLeft}>
                    <Text style={styles.statusTitleSm}>{t('focus.autoNextAccessibilityStatus')}</Text>
                    <Text style={styles.guardDesc}>{t('focus.autoNextAccessibilityStatusDesc')}</Text>
                  </View>
                  <View style={[styles.pulsePill, !hasAutoNextPermission && styles.pulsePillWarning]}>
                    <View style={[styles.pulseDot, !hasAutoNextPermission && styles.pulseDotWarning]} />
                    <Text style={[styles.pulsePillText, !hasAutoNextPermission && styles.pulsePillTextWarning]}>
                      {hasAutoNextPermission ? t('focus.running') : t('focus.permissionNeeded')}
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* 3. Session Controls */}
        <View style={styles.controlsRow}>
          <Pressable
            onPress={() => update({ autoNext: !settings.autoNext })}
            style={[styles.controlBtn, settings.autoNext ? styles.controlBtnAmber : styles.controlBtnEmerald]}
          >
            <Feather name={settings.autoNext ? 'pause' : 'play'} size={16} color={settings.autoNext ? colors.warning : colors.successLight} />
            <Text style={[styles.controlBtnText, { color: settings.autoNext ? colors.warning : colors.successLight }]}>
              {settings.autoNext ? t('focus.pause') : t('focus.continueLabel')}
            </Text>
          </Pressable>
          <Pressable onPress={() => setShowFinishConfirm(true)} style={[styles.controlBtn, styles.controlBtnRed]}>
            <Feather name="check-circle" size={16} color={colors.dangerLight} />
            <Text style={[styles.controlBtnText, { color: colors.dangerLight }]}>{t('overlay.endSession')}</Text>
          </Pressable>
        </View>

        {/* 4. Extend Time */}
        <View style={styles.extendCard}>
          <View style={styles.extendLeft}>
            <Feather name="clock" size={16} color="#818CF8" />
            <Text style={styles.extendLabel}>{t('focus.extendTime')}</Text>
          </View>
          <View style={styles.extendChips}>
            {[10, 20, 30].map((amt) => (
              <Pressable key={amt} onPress={() => extendSession(amt)} style={styles.extendChip}>
                <Text style={styles.extendChipText}>+{amt}m</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 5. Interventions & Shields */}
        <View style={styles.card}>
          <View style={styles.interventionRow}>
            <View>
              <Text style={styles.interventionTitle}>{t('focus.breakReminder')}</Text>
              <Text style={styles.interventionSub}>{t('focus.every15m')}</Text>
            </View>
            <Switch
              value={settings.breakIntervalMinutes > 0}
              onValueChange={(v) => update({ breakIntervalMinutes: v ? 15 : 0 })}
              trackColor={{ true: colors.primary, false: '#262626' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#262626"
            />
          </View>
          <View style={[styles.interventionRow, styles.interventionRowBordered]}>
            <View>
              <Text style={styles.interventionTitle}>{t('focus.healthyPause')}</Text>
              <Text style={styles.interventionSub}>{t('focus.after18Videos')}</Text>
            </View>
            <View style={styles.interventionRight}>
              <Pressable onPress={() => setShowPromptDemo(true)}>
                <Text style={styles.demoLink}>{t('focus.demo')}</Text>
              </Pressable>
              <Switch
                value={settings.preSessionBreathing}
                onValueChange={(v) => update({ preSessionBreathing: v })}
                trackColor={{ true: colors.primary, false: '#262626' }}
              />
            </View>
          </View>
        </View>

        {/* 6. Session Stats */}
        <View>
          <Text style={styles.sectionLabel}>{t('focus.sessionStats')}</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('focus.videos')}</Text>
              <Text style={styles.statTileValue}>{todayVideosWatched}</Text>
              <Text style={styles.statTileFoot}>{t('focus.watched')}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('focus.elapsed')}</Text>
              <Text style={[styles.statTileValue, styles.statTileValuePrimary]}>{todayUsageMinutes}m</Text>
              <Text style={styles.statTileFoot}>{t('focus.watched')}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('focus.avgWatch')}</Text>
              <Text style={[styles.statTileValue, styles.statTileValueSuccess]}>{todayAverageDurationSeconds}s</Text>
              <Text style={styles.statTileFoot}>{t('focus.average')}</Text>
            </View>
          </View>
        </View>

        {/* 7. iOS Pace Feed / dev POC 진입 (2026-07-18 iOS 전략 확정 — PACE_ARCHITECTURE.md 참고).
            Pace Feed = iOS에서 YouTube Shorts를 순차 재생하는 자체 화면(iOS 전용).
            QA #19 수정(2026-07-19): capabilities.supportsPaceFeed(iOS 전용)로 섹션 전체를 게이팅 —
            이전엔 라벨 접미사만 iOS 조건이고 버튼은 무조건 렌더돼 Android에도 노출됐음.
            NOTE(i18n): 스캐폴드 단계라 리터럴 문자열 — feed.* 키 배선은 후속 작업. */}
        {capabilities.supportsPaceFeed && (
        <View>
          <Text style={styles.sectionLabel}>Pace Feed</Text>
          <Pressable onPress={() => router.push('/feed')} style={styles.feedEntryBtn}>
            <View style={styles.feedEntryLeft}>
              <View style={styles.feedEntryIcon}><Feather name="play-circle" size={18} color={colors.successLight} /></View>
              <View style={styles.feedEntryTextWrap}>
                <Text style={styles.feedEntryTitle}>Open Pace Feed</Text>
                <Text style={styles.feedEntrySub}>차단 대신 볼 차분한 대체 피드</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textSecondary} />
          </Pressable>
          {__DEV__ && (
            <Pressable onPress={() => router.push('/dev/shorts-poc')} style={[styles.feedEntryBtn, styles.devEntryBtn]}>
              <View style={styles.feedEntryLeft}>
                <View style={styles.feedEntryIcon}><Feather name="alert-triangle" size={16} color={colors.warning} /></View>
                <View style={styles.feedEntryTextWrap}>
                  <Text style={styles.feedEntryTitle}>Shorts WebView POC (dev)</Text>
                  <Text style={styles.feedEntrySub}>원안 ① 자동넘김 검증용 · 출시 금지</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
        )}

        {/* 8. Hands-Free Control(2026-07-19, 사용자 지시 — Bluetooth 이어폰 Next/Previous/Play-Pause).
            Android: 버튼 탭 = 실제 하드웨어 리모컨과 같은 네이티브 경로(스와이프/토스트/카운터 전부
            동일). iOS: 화면 안 재생(Pace Feed) 조작에는 실제 하드웨어 연동(react-native-track-player)
            이 있지만, 이 카드의 버튼은 어느 화면이든 상태 표시/토글 용도라 로컬 no-op에 가깝다 — 실제
            리모컨 신호 자체는 Xcode/실기기가 없어 이번 라운드에서 검증 못 했음(정직하게 배지로 표시). */}
        {capabilities.supportsHandsFreeControl && (
        <View>
          <Text style={styles.sectionLabel}>Hands-Free Control</Text>
          <View style={styles.handsFreeCard}>
            <View style={styles.handsFreeStatusRow}>
              <View style={styles.handsFreeStatusLeft}>
                <Feather name="headphones" size={16} color={bluetooth.isConnected ? colors.successLight : colors.textSecondary} />
                <Text style={styles.handsFreeStatusText}>
                  {bluetooth.isConnected ? (bluetooth.deviceName ?? 'Connected') : 'Not Connected'}
                </Text>
              </View>
              {/* healthy-shorts-assistant(3) 뱃지 필 스타일 이식 — connected/not connected 둘 다 표시.
                  (3)의 device-selector 드롭다운/가짜 배터리%/"Connect Device" 버튼(앱에서 실제로 블루투스
                  페어링을 못 시키므로 눌러도 아무 일도 안 일어나는 가짜 버튼)/키보드 단축키 가이드(웹
                  전용 개념, 모바일에 해당 없음)는 이식하지 않음 — 아래 3버튼이 이미 실제 동작하는
                  컨트롤이라 대체할 필요가 없다. */}
              <View style={styles.handsFreeStatusRight}>
                <View style={[styles.connectionPill, bluetooth.isConnected ? styles.connectionPillOn : styles.connectionPillOff]}>
                  <View style={[styles.connectionPillDot, bluetooth.isConnected ? styles.connectionPillDotOn : styles.connectionPillDotOff]} />
                  <Text style={[styles.connectionPillText, bluetooth.isConnected ? styles.connectionPillTextOn : styles.connectionPillTextOff]}>
                    {bluetooth.isConnected ? 'Connected' : 'Not Connected'}
                  </Text>
                </View>
                {!capabilities.bluetoothHardwareVerified && (
                  <View style={styles.unverifiedBadge}>
                    <Text style={styles.unverifiedBadgeText}>Unverified</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={styles.handsFreeButtonRow}>
              <Pressable onPress={() => bluetooth.previous()} style={styles.handsFreeBtn}>
                <Feather name="skip-back" size={18} color={colors.textPrimary} />
                <Text style={styles.handsFreeBtnLabel}>Previous</Text>
              </Pressable>
              <Pressable onPress={() => bluetooth.next()} style={styles.handsFreeBtn}>
                <Feather name="skip-forward" size={18} color={colors.textPrimary} />
                <Text style={styles.handsFreeBtnLabel}>Next</Text>
              </Pressable>
              <Pressable onPress={() => bluetooth.toggleAutoMode()} style={[styles.handsFreeBtn, bluetooth.autoModeEnabled && styles.handsFreeBtnActive]}>
                <Feather name={bluetooth.autoModeEnabled ? 'pause' : 'play'} size={18} color={bluetooth.autoModeEnabled ? '#000000' : colors.textPrimary} />
                <Text style={[styles.handsFreeBtnLabel, bluetooth.autoModeEnabled && styles.handsFreeBtnLabelActive]}>Auto Mode</Text>
              </Pressable>
            </View>
          </View>
        </View>
        )}
      </ScrollView>

      {/* Demo Mindful Break Prompt Modal */}
      <Modal visible={showPromptDemo} transparent animationType="fade" onRequestClose={() => setShowPromptDemo(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.modalCardIndigo]}>
            <View style={styles.modalIconIndigo}>
              <Feather name="alert-circle" size={24} color={colors.primary} />
            </View>
            <Text style={styles.modalTitle}>{t('focus.timeToPause')}</Text>
            <Text style={styles.modalBody}>{t('focus.timeToPauseBody', { n: 18 })}</Text>
            <Pressable onPress={() => setShowPromptDemo(false)} style={styles.modalPrimaryBtn}>
              <Text style={styles.modalPrimaryBtnText}>{t('focus.continueMindfulWatch')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Finish Session Confirmation Modal */}
      <Modal visible={showFinishConfirm} transparent animationType="fade" onRequestClose={() => setShowFinishConfirm(false)}>
        <View style={[styles.modalBackdrop, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
          <View style={[styles.modalCard, styles.modalCardRed]}>
            <View style={styles.modalIconRed}>
              <Feather name="check-circle" size={24} color={colors.dangerLight} />
            </View>
            <Text style={styles.modalTitle}>{t('overlay.endSession')}</Text>
            <Text style={styles.modalBody}>{t('focus.finishConfirmBody')}</Text>
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => setShowFinishConfirm(false)} style={styles.modalSecondaryBtn}>
                <Text style={styles.modalSecondaryBtnText}>{t('settings.cancel')}</Text>
              </Pressable>
              <Pressable onPress={confirmFinish} style={styles.modalDangerBtn}>
                <Text style={styles.modalPrimaryBtnText}>{t('focus.yesFinish')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AccessibilityOnboardingSheet
        visible={showAccessibilityOnboarding}
        onEnable={() => autoNextService.requestPermission()}
        onDismiss={() => setShowAccessibilityOnboarding(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg, paddingBottom: layout.tabBarContentClearance },

  heroCard: { borderRadius: 30, padding: 24, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  liveTag: { position: 'absolute', top: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: '#A5B4FC', letterSpacing: 0.5, textTransform: 'uppercase' },
  heroLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase' },
  heroTitle: { fontSize: 24, fontFamily: typography.displayFontFamily, color: colors.textPrimary, marginTop: 4 },
  splitRow: { flexDirection: 'row', gap: spacing.md, paddingTop: 6 },
  splitCol: { flex: 1, borderLeftWidth: 2, borderLeftColor: `${colors.primary}66`, paddingLeft: spacing.sm },
  splitColRight: { borderLeftColor: `${colors.primary}CC` },
  splitLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  splitValue: { fontSize: 20, fontFamily: typography.monoFontFamilyBold, color: colors.textPrimary, marginTop: 2 },
  splitValuePrimary: { color: colors.primary },
  heroTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.pill, overflow: 'hidden' },
  heroFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },

  sectionLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },
  statusTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  statusTitleSm: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  pulsePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.successLight },
  pulsePillText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.5, textTransform: 'uppercase' },
  // 권한 미부여 상태 — 예전엔 이 상태 자체가 없어(하드코딩) 표현할 필요가 없었다. 탭하면 설정으로 이동.
  pulsePillWarning: { backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.2)' },
  pulseDotWarning: { backgroundColor: colors.warning },
  pulsePillTextWarning: { color: colors.warning },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 },
  statusRowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  statusRowLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilySemibold, color: colors.textSecondary },
  statusRowValueMono: { fontSize: 12, fontFamily: typography.monoFontFamilyBold, color: colors.textPrimary },
  statusRowValueMonoPrimary: { fontSize: 12, fontFamily: typography.monoFontFamilyBold, color: colors.primary },

  guardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  guardRowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: spacing.xs, paddingTop: spacing.sm },
  guardLeft: { flex: 1, paddingRight: spacing.sm },
  guardDesc: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },

  controlsRow: { flexDirection: 'row', gap: spacing.sm },
  controlBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.card - 8, borderWidth: 1 },
  controlBtnAmber: { backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.2)' },
  controlBtnEmerald: { backgroundColor: colors.successBg, borderColor: 'rgba(16,185,129,0.2)' },
  controlBtnRed: { backgroundColor: colors.dangerBg, borderColor: 'rgba(239,68,68,0.2)' },
  controlBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 1, textTransform: 'uppercase' },

  extendCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  extendLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  extendLabel: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#D1D5DB', letterSpacing: 0.5, textTransform: 'uppercase' },
  extendChips: { flexDirection: 'row', gap: 6 },
  extendChip: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  extendChipText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: '#818CF8', letterSpacing: 0.5 },

  interventionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  interventionRowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: spacing.xs, paddingTop: spacing.md },
  interventionTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  interventionSub: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: '#818CF8', marginTop: 2 },
  interventionRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  demoLink: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, textDecorationLine: 'underline', letterSpacing: 0.5, textTransform: 'uppercase' },

  statsGrid: { flexDirection: 'row', gap: spacing.sm },
  statTile: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.md, alignItems: 'center' },
  statTileLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase' },
  statTileValue: { fontSize: 22, fontFamily: typography.displayFontFamily, color: colors.textPrimary, marginVertical: spacing.xs },
  statTileValuePrimary: { color: colors.primary },
  statTileValueSuccess: { color: colors.successLight },
  statTileFoot: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary, textTransform: 'uppercase' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 320, borderRadius: 28, padding: 24, alignItems: 'center', gap: spacing.md, borderWidth: 1 },
  modalCardIndigo: { backgroundColor: colors.card, borderColor: `${colors.primary}66` },
  modalCardRed: { backgroundColor: colors.card, borderColor: 'rgba(239,68,68,0.3)' },
  modalIconIndigo: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: `${colors.primary}33`, alignItems: 'center', justifyContent: 'center' },
  modalIconRed: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, textAlign: 'center' },
  modalBody: { fontSize: 12, color: '#D1D5DB', textAlign: 'center', lineHeight: 18 },
  modalPrimaryBtn: { width: '100%', backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalPrimaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },
  modalButtonRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  modalSecondaryBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalSecondaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary, textTransform: 'uppercase' },
  modalDangerBtn: { flex: 1, backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },

  feedEntryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.sm },
  devEntryBtn: { borderColor: 'rgba(245,158,11,0.25)', borderStyle: 'dashed' },
  feedEntryLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  feedEntryTextWrap: { flex: 1 },
  feedEntryIcon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  feedEntryTitle: { fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  feedEntrySub: { fontSize: 11, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, marginTop: 2 },

  handsFreeCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.md, gap: spacing.md },
  handsFreeStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  handsFreeStatusLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  handsFreeStatusRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  handsFreeStatusText: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  connectionPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 1 },
  connectionPillOn: { backgroundColor: `${colors.primary}1A`, borderColor: `${colors.primary}33` },
  connectionPillOff: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.05)' },
  connectionPillDot: { width: 6, height: 6, borderRadius: 3 },
  connectionPillDotOn: { backgroundColor: colors.primary },
  connectionPillDotOff: { backgroundColor: colors.textTertiary },
  connectionPillText: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, letterSpacing: 0.5, textTransform: 'uppercase' },
  connectionPillTextOn: { color: colors.primary },
  connectionPillTextOff: { color: colors.textSecondary },
  unverifiedBadge: { backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  unverifiedBadgeText: { fontSize: 9, fontFamily: typography.bodyFontFamilyBold, color: colors.warning, textTransform: 'uppercase' },
  handsFreeButtonRow: { flexDirection: 'row', gap: spacing.sm },
  handsFreeBtn: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.button, paddingVertical: spacing.sm },
  handsFreeBtnActive: { backgroundColor: colors.successLight },
  handsFreeBtnLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary },
  handsFreeBtnLabelActive: { color: '#000000' },
});
