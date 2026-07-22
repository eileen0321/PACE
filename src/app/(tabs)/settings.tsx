import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
// ⚠️ 2026-07-22 감사 수정: expo-file-system/sharing/store-review를 top-level import하면, 이 네이티브
// 모듈들이 없는 빌드(=아직 재빌드 안 한 기기)에서 requireNativeModule이 모듈 로드 시점에 throw →
// settings.tsx가 default export를 못 해 탭 전체가 먹통(까만화면)이 됐다. 실제로 쓰는 핸들러 안에서만
// lazy require하도록 바꿔, 모듈이 없어도 화면은 정상 뜨고 해당 기능만 graceful하게 실패하게 한다.
import { useUserStore } from '../../store/useUserStore';
import { useSubscriptionStore } from '../../store/useSubscriptionStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../store/useSettingsStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useLimitHitStore } from '../../store/useLimitHitStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useToastStore } from '../../store/useToastStore';
import { clearUserHistory, getAllSessionsForExport } from '../../database/repositories/sessionsRepository';
import { getWeeklyStats } from '../../database/repositories/statsRepository';
import { capabilities, overlayService, autoNextService } from '../../services/platform';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { requestNotificationPermission, notifyAccessibilityNeeded } from '../../services/notifications';
import { AppHeader } from '../../components/ui/AppHeader';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { AccessibilityOnboardingSheet } from '../../components/onboarding/AccessibilityOnboardingSheet';
import { bottomSheetPadding, colors, layout, radius, spacing, typography } from '../../constants/theme';
import type { UserSettings } from '../../types/models';

// 2026-07-21 밤 감사 발견 — 실제 모니터링되는 지원 이메일이 없어(백엔드/도메인 미확정) 앱 전체가
// 이미 쓰는 게스트 이메일 폴백 도메인(guest@pace.app)과 통일된 자리표시자를 쓴다. 출시 전 실제
// 수신함으로 교체 필수 — 지금은 버튼이 죽어있는 것보다 우선 연결해두고 나중에 주소만 바꾸면 됨.
const SUPPORT_EMAIL = 'support@pace.app';

const FAQ_KEYS: [TranslationKey, TranslationKey][] = [
  ['settings.faqQ1', 'settings.faqA1'],
  ['settings.faqQ2', 'settings.faqA2'],
  ['settings.faqQ3', 'settings.faqA3'],
  ['settings.faqQ4', 'settings.faqA4'],
  ['settings.faqQ5', 'settings.faqA5'],
];

const LANGUAGE_OPTIONS: { value: UserSettings['language']; labelKey: 'settings.languageSystem' | 'settings.languageEnglish' | 'settings.languageKorean' }[] = [
  { value: 'system', labelKey: 'settings.languageSystem' },
  { value: 'en', labelKey: 'settings.languageEnglish' },
  { value: 'ko', labelKey: 'settings.languageKorean' },
];
const SLEEP_TIMER_OPTIONS = [15, 30, 45, 60, 0];
const DAILY_LIMIT_OPTIONS = [30, 45, 60, 90, 120];
const BREAK_OPTIONS = [10, 15, 20, 30, 0];
// 2026-07-20 사용자 지시 — Focus Session(자동넘김) 지속 시간을 10분 하드코딩이 아니라 직접 고르게.
const FOCUS_SESSION_DURATION_OPTIONS = [5, 10, 20, 30, 60];

function cycle(options: number[], current: number): number {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length];
}

// healthy-shorts-assistant(2) SettingsTab.tsx를 토씨 하나 안 틀리고 그대로 이식(사용자 명시적
// 지시) — Account / Session Defaults / Connected Apps / Platform Configuration / Notifications /
// Privacy / Support / Advanced(Reset) 8섹션. 원본은 Session Defaults를 실제 세션과 무관한 로컬
// 데모 state로 관리했는데, Pace는 애초에 "기본값=실제 설정" 하나뿐이라 useSettingsStore에 직접
// 연결(더 정확한 동작 — 죽은 데모 state를 만들지 않음). "Platform Configuration"의 안드로이드↔iOS
// 전환 버튼은 브라우저 프리뷰용 데모 기능이라 뺐다(실제 앱은 Platform.OS가 고정, 전환할 대상이
// 없음) — 대신 실제 Platform.OS에 맞는 정보만 정직하게 표시. 언어 선택기와 구독/paywall 행은
// Pace 자체 기능이라 유지(원본에 없음).
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useUserStore((s) => s.user);
  const logout = useUserStore((s) => s.logout);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const isReviewer = useSubscriptionStore((s) => s.isReviewer);
  const { settings, update } = useSettingsStore();
  const { todayUsageMinutes } = useStatsStore();
  const { extraMinutes: bonusMinutes } = useDailyBonusStore();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const bluetooth = useBluetoothStore();
  // 2026-07-20 실기기 감사 중 발견: "Platform Configuration" 카드의 READY 배지가 실제 오버레이
  // 권한 상태와 무관하게 항상 켜져 있었다(Dev Client 안 붙었거나 사용자가 권한을 거부해도 계속
  // READY라고 표시) — 실제 권한 상태로 교체. overlayReady는 Platform Configuration 배지와
  // 아래 Session Status/Android Guard Services 카드의 오버레이 상태 행이 공유(동일 권한이라
  // 별도 state로 이중 폴링할 필요 없음).
  const [overlayReady, setOverlayReady] = useState(false);
  const [hasUsageAccessPermission, setHasUsageAccessPermission] = useState(false);
  const [hasAutoNextPermission, setHasAutoNextPermission] = useState(false);
  const [showAccessibilityOnboarding, setShowAccessibilityOnboarding] = useState(false);

  // 2026-07-22 사용자 지시 — Focus 탭의 "Session Status"/"Android Guard Services" 카드를 이 화면으로
  // 이전(포커스 탭에서 중복 삭제 지시에 준해 정리). 원래 focus.tsx에 있던 권한 폴링 로직 그대로
  // 이식 — 마운트 시 1회 + AppState 'active'(다른 화면에서 권한 부여하고 돌아올 때)마다 재조회.
  useEffect(() => {
    bluetooth.refresh();
    let cancelled = false;
    const check = async () => {
      const [overlay, usageAccess, autoNextPermission] = await Promise.all([
        overlayService.hasOverlayPermission(),
        overlayService.hasForegroundDetectionPermission(),
        capabilities.supportsAutoNext ? autoNextService.hasPermission() : Promise.resolve(false),
      ]);
      if (cancelled) return;
      setOverlayReady(overlay);
      setHasUsageAccessPermission(usageAccess);
      if (autoNextPermission && !hasAutoNextPermission && showAccessibilityOnboarding) {
        setShowAccessibilityOnboarding(false);
        useToastStore.getState().show(`✅ ${t('focus.handsFreeEnabledToast')}`);
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

  const remainingMinutes = Math.max(0, settings.dailyLimitMinutes + bonusMinutes - todayUsageMinutes);

  // 2026-07-18: 알림 토글은 이전엔 화면 로컬 state라 탭을 벗어나면 항상 기본값으로 리셋되고 실제
  // 알림 발송 여부(services/notifications)에도 전혀 반영되지 않았다 — useSettingsStore에 직결해
  // ON을 켜면 requestNotificationPermission()도 즉시 트리거(권한이 없으면 알림이 안 갈 걸 미리 확인).
  const onToggleNotif = (key: 'notifyRemaining' | 'notifyLimit' | 'notifyBreak') => (value: boolean) => {
    update({ [key]: value });
    if (value) requestNotificationPermission().catch(() => {});
  };

  const name = (user?.name ?? user?.email?.split('@')[0] ?? t('settings.guestLabel')).trim();
  const initials = name.slice(0, 2).toUpperCase();

  // 2026-07-20 실기기 감사 중 발견(맥 세션 QA_ISSUES_2026-07-18.md #5) — 문구는 "모든 맞춤형 제한 및
  // 카운터 초기화"를 약속하는데 실제로는 logout()만 호출해 로그아웃 화면으로 튕길 뿐, 설정도 사용
  // 기록도 전혀 안 지워졌다(로컬 게스트라 재로그인하면 동일 데이터 그대로 복귀 — 사실상 무동작이었음).
  // 진짜로 설정을 기본값으로 되돌리고 SQLite 사용 기록을 지운다. 로그아웃은 별개 동작이라(계정
  // 화면에 이미 있음) 여기서는 하지 않는다.
  const confirmReset = () => {
    setShowResetConfirm(false);
    update(DEFAULT_SETTINGS);
    useDailyBonusStore.getState().resetToday().catch(() => {});
    useLimitHitStore.getState().resetToday().catch(() => {});
    if (user?.id) {
      clearUserHistory(user.id)
        .then(() => useStatsStore.getState().refresh(user.id))
        .catch(() => {});
    }
  };

  // 2026-07-21 밤 감사 발견 — Export Data 행이 onPress 자체가 없어 완전히 죽어있었다. Privacy
  // 섹션이 "기기 로컬에만 저장"을 명시하는 이상, 그 로컬 데이터를 실제로 꺼내볼 수 있어야 문구와
  // 동작이 일치한다 — 세션 이력 전체 + 주간 통계 + 현재 설정을 JSON으로 묶어 공유시트로 내보낸다.
  const handleExportData = async () => {
    if (!user?.id) return;
    try {
      const [sessions, weeklyStats] = await Promise.all([
        getAllSessionsForExport(user.id),
        getWeeklyStats(user.id),
      ]);
      const payload = { exportedAt: new Date().toISOString(), settings, weeklyStats, sessions };
      const { File, Paths } = require('expo-file-system'); // lazy: 미링크 빌드에서 화면 죽지 않게
      const Sharing = require('expo-sharing');
      const file = new File(Paths.cache, `pace-export-${Date.now()}.json`);
      file.create();
      file.write(JSON.stringify(payload, null, 2));
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: t('settings.exportData') });
      } else {
        Alert.alert(t('settings.exportData'), file.uri);
      }
    } catch (e) {
      console.warn('[settings] export failed', e);
      Alert.alert(t('settings.exportData'), t('settings.exportFailed'));
    }
  };

  const handleSendFeedback = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Pace Feedback')}`).catch(() => {
      Alert.alert(t('settings.sendFeedback'), t('settings.feedbackFailed'));
    });
  };

  const handleRateApp = async () => {
    try {
      const StoreReview = require('expo-store-review'); // lazy: 미링크 빌드에서 화면 죽지 않게
      const available = await StoreReview.isAvailableAsync();
      if (available) await StoreReview.requestReview();
      else Alert.alert(t('settings.rateApp'), t('settings.rateAppUnavailable'));
    } catch (e) {
      console.warn('[settings] rate app failed', e);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>{t('settings.screenTitle')}</Text>

        {/* 1. Account */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.account')}</Text>
          <GlassSurface style={[styles.card, styles.singleCard, styles.accountCard]}>
            <View style={styles.accountLeft}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
              <View>
                <View style={styles.nameRow}>
                  <Text style={styles.profileName}>{name.toUpperCase()}</Text>
                  {isPremium && <View style={styles.premiumTag}><Text style={styles.premiumTagText}>{isReviewer ? 'REVIEWER' : t('settings.premium')}</Text></View>}
                </View>
                <Text style={styles.profileEmail}>{user?.isGuest ? t('settings.guestLabel') : user?.email ?? '-'}</Text>
              </View>
            </View>
            <Pressable style={styles.manageSubBtn} onPress={() => router.push('/paywall')}>
              <Text style={styles.manageSubText}>{t('settings.manageSub')}</Text>
              <Feather name="chevron-right" size={14} color="#818CF8" />
            </Pressable>
          </GlassSurface>
          {/* 2026-07-20 실기기 감사 중 발견: logout()을 호출하는 UI가 이 화면 어디에도 없었다 —
              이전엔 "설정 초기화" 버튼 하나가 로그아웃까지 겸하고 있었는데(문구와 안 맞는 부작용),
              그걸 정직한 데이터 초기화로 고치면서 로그아웃할 방법 자체가 사라질 뻔했다. 게스트는
              로그아웃할 실제 계정이 없으므로 로그인된 사용자에게만 노출. */}
          {!user?.isGuest && (
            <Pressable style={styles.logoutRow} onPress={logout}>
              <Feather name="log-out" size={14} color={colors.danger} />
              <Text style={styles.logoutRowText}>{t('settings.logout')}</Text>
            </Pressable>
          )}
        </View>

        {/* 2. Session Defaults — Pace는 데모 로컬 state 대신 실제 useSettingsStore에 직결 */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.sessionDefaults')}</Text>
          <GlassSurface style={styles.card}>
            <DefaultRow
              title={t('settings.defaultSleep')} desc={t('settings.defaultSleepDesc')}
              value={settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : t('focus.off')}
              onPress={() => update({ sleepTimerMinutes: cycle(SLEEP_TIMER_OPTIONS, settings.sleepTimerMinutes ?? 0) || null })}
            />
            <DefaultRow
              title={t('settings.defaultLimit')} desc={t('settings.defaultLimitDesc')}
              value={`${settings.dailyLimitMinutes}m`} bordered
              onPress={() => update({ dailyLimitMinutes: cycle(DAILY_LIMIT_OPTIONS, settings.dailyLimitMinutes) })}
            />
            <DefaultRow
              title={t('settings.defaultBreak')} desc={t('settings.defaultBreakDesc')}
              value={settings.breakIntervalMinutes ? `${settings.breakIntervalMinutes}m` : t('focus.off')} bordered
              onPress={() => update({ breakIntervalMinutes: cycle(BREAK_OPTIONS, settings.breakIntervalMinutes) })}
            />
            <DefaultRow
              title={t('settings.focusSessionDuration')} desc={t('settings.focusSessionDurationDesc')}
              value={`${settings.focusSessionDurationMinutes}m`} bordered
              onPress={() => {
                const next = cycle(FOCUS_SESSION_DURATION_OPTIONS, settings.focusSessionDurationMinutes);
                update({ focusSessionDurationMinutes: next });
                // Android만 실제 효과 있음(네이티브 Kotlin 자동 종료 타이머가 이 미러 값을 직접
                // 읽음) — iOS는 bluetoothService.ios.ts에서 no-op이라 안전하게 무시됨.
                if (Platform.OS === 'android') bluetooth.setFocusSessionDurationMinutes(next);
              }}
            />
          </GlassSurface>
        </View>

        {/* 3. Connected Apps — 실제 appShields 상태 반영 */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.connectedApps')}</Text>
          <GlassSurface style={styles.card}>
            <ConnectedAppRow label={t('home.youtubeShorts')} active={settings.appShields.youtube} />
            <ConnectedAppRow label={t('home.instagramReels')} active={settings.appShields.instagram} bordered />
            <ConnectedAppRow label={t('home.tiktokVideoLoop')} active={settings.appShields.tiktok} bordered />
          </GlassSurface>
        </View>

        {/* 4. Platform Configuration — 실제 Platform.OS 고정 표시(데모 토글 버튼 제외) */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.platform')}</Text>
          <GlassSurface style={[styles.card, styles.singleCard]}>
            <View style={styles.platformRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{Platform.OS === 'android' ? t('settings.overlayAssistant') : t('settings.pacePlayer')}</Text>
                <Text style={styles.rowSubtitle}>{Platform.OS === 'android' ? t('settings.overlayAssistantDesc') : t('settings.pacePlayerDesc')}</Text>
              </View>
              <View style={[styles.readyTag, !overlayReady && styles.statusTagOff]}>
                <Text style={[styles.readyTagText, !overlayReady && styles.statusTagTextOff]}>
                  {overlayReady ? t('settings.ready') : t('settings.permissionNeededShort')}
                </Text>
              </View>
            </View>
          </GlassSurface>
        </View>

        {/* 4.5 Session Status (2026-07-22 사용자 지시로 Focus 탭에서 이전) */}
        <View>
          <Text style={styles.sectionLabel}>{t('focus.sessionStatus')}</Text>
          <GlassSurface style={[styles.card, styles.singleCard]} intensity={20}>
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

        {/* 4.6 Android Guard Services (Android 전용, 2026-07-22 사용자 지시로 Focus 탭에서 이전) */}
        {Platform.OS === 'android' && (
          <View>
            <Text style={styles.sectionLabel}>{t('focus.androidGuardServices')}</Text>
            <View style={[styles.card, styles.singleCard]}>
              <Pressable style={styles.guardRow} onPress={() => !overlayReady && overlayService.requestOverlayPermission()}>
                <View style={styles.guardLeft}>
                  <Text style={styles.statusTitleSm}>{t('focus.overlayStatus')}</Text>
                  <Text style={styles.guardDesc}>{t('focus.overlayStatusDesc')}</Text>
                </View>
                <View style={[styles.pulsePill, !overlayReady && styles.pulsePillWarning]}>
                  <View style={[styles.pulseDot, !overlayReady && styles.pulseDotWarning]} />
                  <Text style={[styles.pulsePillText, !overlayReady && styles.pulsePillTextWarning]}>
                    {overlayReady ? t('focus.connected') : t('focus.notConnected')}
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

        {/* 5. Notifications */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.notifications')}</Text>
          <GlassSurface style={styles.card}>
            <NotifRow title={t('settings.remainingAlert')} desc={t('settings.remainingAlertDesc')} value={settings.notifyRemaining} onChange={onToggleNotif('notifyRemaining')} />
            <NotifRow title={t('settings.limitAlert')} desc={t('settings.limitAlertDesc')} value={settings.notifyLimit} onChange={onToggleNotif('notifyLimit')} bordered />
            <NotifRow title={t('focus.breakReminder')} desc={t('settings.breakReminderAlertDesc')} value={settings.notifyBreak} onChange={onToggleNotif('notifyBreak')} bordered />
          </GlassSurface>
        </View>

        {/* 5.6 Enforcement — 2026-07-19 사용자 제품 결정: 한도 도달 시 전체화면 Overlay 차단은
            항상 켜짐(옵트아웃 불가, Android 네이티브에서 자동 처리)이라 여기 토글이 없다. 이 토글은
            그 위에 "YouTube 자체를 강제 종료"까지 할지의 옵트인 스위치 — 기본 OFF, 침해적인 동작이라
            명확한 고지 문구 필수(정책 리서치에서 확인한 요건). */}
        {Platform.OS === 'android' && (
          <View>
            <Text style={styles.sectionLabel}>{t('settings.enforcementSection')}</Text>
            <GlassSurface style={styles.card}>
              <NotifRow
                title={t('settings.hardBlockMode')}
                desc={t('settings.hardBlockModeDesc')}
                value={settings.hardBlockMode}
                onChange={(value) => update({ hardBlockMode: value })}
              />
            </GlassSurface>
          </View>
        )}

        {/* 5.7 Playback Controls(2026-07-19, 사용자 지시 — Bluetooth Hands-Free) */}
        {capabilities.supportsHandsFreeControl && (
        <View>
          <Text style={styles.sectionLabel}>{t('settings.playbackControls')}</Text>
          <GlassSurface style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{t('settings.handsFreeControl')}</Text>
              <View style={styles.statusTag}>
                <Text style={styles.statusTagText}>{capabilities.bluetoothHardwareVerified ? t('settings.ready') : 'BETA'}</Text>
              </View>
            </View>
            <View style={[styles.row, styles.rowBordered]}>
              <Text style={styles.rowTitle}>{t('settings.connectedDevice')}</Text>
              <Text style={styles.privacyValue}>{bluetooth.isConnected ? (bluetooth.deviceName ?? t('focus.connected')) : t('focus.notConnected')}</Text>
            </View>
            <View style={[styles.row, styles.rowBordered]}>
              <Text style={styles.rowTitle}>{t('settings.playPauseAction')}</Text>
              <Text style={styles.privacyValue}>{t('settings.toggleAutoMode')}</Text>
            </View>
          </GlassSurface>
        </View>
        )}

        {/* 5.5 Privacy — SettingsTab.tsx SECTION 6, 이전 버전에서 통째로 빠뜨렸던 섹션 */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.privacy')}</Text>
          <GlassSurface style={styles.card}>
            {/* 2026-07-20 실기기 감사 중 발견: "Usage Analytics: ENABLED" 배지가 어떤 실제 기능과도
                연결 안 된 상태였다 — 코드 전체에 서드파티/외부 분석(analytics) 수집이 아예 존재하지
                않는데도(grep 결과 이 화면과 번역 문자열 말고는 "analytics" 언급 자체가 없음) 켜져
                있다고 표시하고 있었다. "don't fake data" 원칙 위반이라 제거 — 로컬 데이터 행이
                이미 실제로 저장되는 것(기기 로컬)을 정직하게 설명하고 있으므로 중복도 아님. */}
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{t('settings.localData')}</Text>
              <Text style={styles.privacyValue}>{t('settings.storedSafely')}</Text>
            </View>
            <Pressable style={[styles.row, styles.rowBordered]} onPress={handleExportData}>
              <Text style={styles.rowTitle}>{t('settings.exportData')}</Text>
              <Feather name="chevron-right" size={16} color={colors.textSecondary} />
            </Pressable>
          </GlassSurface>
        </View>

        {/* 6. Language (Pace 전용) */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.languageSection')}</Text>
          <GlassSurface style={styles.card}>
            <View style={styles.languageRow}>
              {LANGUAGE_OPTIONS.map((opt) => {
                const active = settings.language === opt.value;
                return (
                  <Pressable key={opt.value} onPress={() => update({ language: opt.value })} style={[styles.languageChip, active && styles.languageChipActive]}>
                    <Text style={[styles.languageChipText, active && styles.languageChipTextActive]}>{t(opt.labelKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </GlassSurface>
        </View>

        {/* 7. Support */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.support')}</Text>
          <GlassSurface style={styles.card}>
            <ChevronRow title={t('settings.replayGuide')} onPress={() => router.push('/onboarding')} />
            <ChevronRow title={t('settings.helpCenter')} bordered onPress={() => setShowHelpCenter(true)} />
            <ChevronRow title={t('settings.sendFeedback')} bordered onPress={handleSendFeedback} />
            <ChevronRow title={t('settings.rateApp')} bordered onPress={handleRateApp} />
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.versionLabel}>{t('settings.version')}</Text>
              <Text style={styles.versionValue}>1.0.0</Text>
            </View>
          </GlassSurface>
        </View>

        {/* 8. Advanced — Reset */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.advanced')}</Text>
          <GlassSurface style={[styles.card, styles.advancedCard]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resetTitle}>{t('settings.resetSettings')}</Text>
              <Text style={styles.rowSubtitle}>{t('settings.resetSettingsDesc')}</Text>
            </View>
            <Pressable style={styles.resetIconBtn} onPress={() => setShowResetConfirm(true)}>
              <Feather name="refresh-cw" size={16} color={colors.dangerLight} />
            </Pressable>
          </GlassSurface>
        </View>
      </ScrollView>

      <Modal visible={showResetConfirm} transparent animationType="fade" onRequestClose={() => setShowResetConfirm(false)}>
        <View style={[styles.modalBackdrop, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('settings.resetSettings')}</Text>
            <Text style={styles.modalBody}>{t('settings.resetConfirmMessage')}</Text>
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => setShowResetConfirm(false)} style={styles.modalSecondaryBtn}>
                <Text style={styles.modalSecondaryBtnText}>{t('settings.cancel')}</Text>
              </Pressable>
              <Pressable onPress={confirmReset} style={styles.modalDangerBtn}>
                <Text style={styles.modalPrimaryBtnText}>{t('settings.resetNow')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 2026-07-21 밤 감사 발견 — Help Center 행이 onPress 자체가 없어 완전히 죽어있었다. 백엔드/CMS가
          없어 외부 지원 페이지로 연결할 수 없으므로, 핵심 기능 FAQ를 앱 안에 직접 담아 최소한의
          실질적 도움을 준다. */}
      <Modal visible={showHelpCenter} transparent animationType="slide" onRequestClose={() => setShowHelpCenter(false)}>
        <View style={[styles.modalBackdrop, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
          <View style={[styles.modalCard, styles.helpCard]}>
            <View style={styles.helpHeaderRow}>
              <Text style={styles.modalTitle}>{t('settings.helpCenterTitle')}</Text>
              <Pressable onPress={() => setShowHelpCenter(false)} hitSlop={10}>
                <Feather name="x" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={styles.helpScroll} showsVerticalScrollIndicator={false}>
              {FAQ_KEYS.map(([qKey, aKey], i) => (
                <View key={i} style={styles.helpItem}>
                  <Text style={styles.helpQuestion}>{t(qKey)}</Text>
                  <Text style={styles.helpAnswer}>{t(aKey)}</Text>
                </View>
              ))}
            </ScrollView>
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

function DefaultRow({ title, desc, value, onPress, bordered }: { title: string; desc: string; value: string; onPress: () => void; bordered?: boolean }) {
  return (
    <View style={[styles.row, bordered && styles.rowBordered]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{desc}</Text>
      </View>
      <Pressable onPress={onPress} style={styles.valuePill}>
        <Text style={styles.valuePillText}>{value}</Text>
        <Feather name="chevron-right" size={14} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function ConnectedAppRow({ label, active, bordered }: { label: string; active: boolean; bordered?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, bordered && styles.rowBordered]}>
      <Text style={styles.rowTitle}>{label}</Text>
      <View style={[styles.statusTag, !active && styles.statusTagOff]}>
        <Text style={[styles.statusTagText, !active && styles.statusTagTextOff]}>{active ? t('settings.active') : t('focus.off')}</Text>
      </View>
    </View>
  );
}

function NotifRow({ title, desc, value, onChange, bordered }: { title: string; desc: string; value: boolean; onChange: (v: boolean) => void; bordered?: boolean }) {
  return (
    <View style={[styles.row, styles.notifRow, bordered && styles.rowBordered]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{desc}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: '#262626' }} thumbColor="#FFFFFF" ios_backgroundColor="#262626" />
    </View>
  );
}

function ChevronRow({ title, bordered, onPress }: { title: string; bordered?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={[styles.row, bordered && styles.rowBordered]} onPress={onPress}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Feather name="chevron-right" size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg, paddingBottom: layout.tabBarContentClearance },
  screenTitle: { fontSize: 24, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  sectionLabel: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 2, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  // App.tsx SettingsTab.tsx 전 섹션이 카드에 p-5/px-5(20px)를 쓰는데 spacing.lg(24px)로 잘못
  // 이식돼 있었다. 리스트형 카드(divide-y)는 각 행이 자체 py-4(16px)로 세로 여백을 담당하므로
  // 카드 자체엔 세로 패딩을 안 준다 — Account/Platform/Advanced처럼 단일 콘텐츠 카드만
  // paddingVertical 20을 별도로 추가(singleCard). 테두리도 구분선(0.04)과 다른 0.05로 분리.
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', borderRadius: radius.card, paddingHorizontal: 20 },
  singleCard: { paddingVertical: 20 },
  accountCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, flex: 1 },
  avatar: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontFamily: typography.displayFontFamily, fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  profileName: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, letterSpacing: -0.2 },
  premiumTag: { backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  premiumTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.primary, letterSpacing: 0.5 },
  profileEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontFamily: typography.bodyFontFamilyMedium },
  manageSubBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  manageSubText: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: '#818CF8' },
  logoutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.sm, paddingVertical: spacing.sm },
  logoutRowText: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.danger },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
  notifRow: { paddingVertical: 18 },
  rowBordered: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: 16 },
  rowLast: { borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: 16 },
  rowTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  rowSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  privacyValue: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  valuePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 6 },
  valuePillText: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: '#818CF8' },

  statusTag: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.1)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  statusTagOff: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: colors.borderSubtle },
  statusTagText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.5, textTransform: 'uppercase' },
  statusTagTextOff: { color: colors.textSecondary },

  platformRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  readyTag: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.1)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  readyTagText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.5, textTransform: 'uppercase' },

  // Session Status / Android Guard Services (2026-07-22 Focus 탭에서 이전, focus.tsx 원본 스타일 그대로)
  statusTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  statusTitleSm: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  pulsePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.successBg, borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)', borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.successLight },
  pulsePillText: { fontSize: 10, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.5, textTransform: 'uppercase' },
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

  languageRow: { flexDirection: 'row', gap: spacing.sm },
  languageChip: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.chip, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center' },
  languageChipActive: { backgroundColor: colors.primary },
  languageChipText: { fontSize: 13, fontFamily: typography.bodyFontFamilyBold, color: colors.textSecondary },
  languageChipTextActive: { color: '#FFFFFF' },

  versionLabel: { fontSize: 11, fontFamily: typography.monoFontFamily, color: colors.textSecondary },
  versionValue: { fontSize: 11, fontFamily: typography.monoFontFamily, color: colors.textSecondary },

  advancedCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
  resetTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.dangerLight },
  resetIconBtn: { width: 36, height: 36, borderRadius: radius.chip, backgroundColor: colors.dangerBg, alignItems: 'center', justifyContent: 'center' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 28, padding: 24, alignItems: 'center', gap: spacing.md },
  modalTitle: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  modalBody: { fontSize: 12, color: '#D1D5DB', textAlign: 'center', lineHeight: 18 },
  modalButtonRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  modalSecondaryBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalSecondaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyBold, color: colors.textPrimary, textTransform: 'uppercase' },
  modalDangerBtn: { flex: 1, backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: radius.button, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  modalPrimaryBtnText: { fontSize: 11, fontFamily: typography.bodyFontFamilyExtrabold, color: '#FFFFFF', letterSpacing: 0.5, textTransform: 'uppercase' },

  helpCard: { maxWidth: 400, maxHeight: '75%', alignItems: 'stretch', borderColor: colors.borderSubtle },
  helpHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  helpScroll: { width: '100%' },
  helpItem: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, gap: 4 },
  helpQuestion: { fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  helpAnswer: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
});
