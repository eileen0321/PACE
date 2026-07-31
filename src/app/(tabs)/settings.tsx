import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { PRIVACY_POLICY_URL } from '../../constants/legal';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
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
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { useToastStore } from '../../store/useToastStore';
import { clearUserHistory } from '../../database/repositories/sessionsRepository';
import { capabilities, overlayService, autoNextService, bluetoothService } from '../../services/platform';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { requestNotificationPermission, notifyAccessibilityNeeded } from '../../services/notifications';
import { AppHeader } from '../../components/ui/AppHeader';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { AccessibilityOnboardingSheet } from '../../components/onboarding/AccessibilityOnboardingSheet';
import { bottomSheetPadding, colors, radius, spacing, typography } from '../../constants/theme';
import type { UserSettings } from '../../types/models';

// 2026-07-26 사용자 지시("이어폰 관련 가이드나 문구도 없애") — faqQ3/A3가 예전엔 "Bluetooth 이어폰
// 리모컨 버튼으로 Shorts를 넘긴다"는, capabilities.supportsHandsFreeControl(하드웨어 미디어 버튼
// 라우팅, Android=불가능 확정)과 동일한 약속이라 이 플래그로 Android에서만 숨겼었다. 지금은 문구를
// 실제로 동작하는 핑거스냅/손짓(PaceSnapDetector/PaceHandWaveDetector, Android 검증 완료)으로
// 바꿨으므로 그 하드웨어 버튼 플래그로 게이팅하는 게 더 이상 안 맞음 — 플랫폼 구분 없이 항상 노출.
// 2026-07-26 사용자 지적("전체 화면 차단 안 하잖아") 감사 — Q1 답변만 플랫폼별로 실제 동작이 달라
// (Android=오버레이 차단, iOS=오버레이 자체가 불가능해 Live Activity 알림뿐) 별도 답변 키로 분리.
const FAQ_KEYS: [TranslationKey, TranslationKey][] = [
  ['settings.faqQ1', Platform.OS === 'ios' ? 'settings.faqA1Ios' : 'settings.faqA1'],
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
// 2026-07-26 사장님 결정(D8, "고급 취침모드") — 무진동 수면감지 임계값, 프리미엄 전용 조절.
const SLEEP_STILLNESS_OPTIONS = [5, 10, 15, 20];

function cycle(options: number[], current: number): number {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length];
}

// healthy-shorts-assistant(2) SettingsTab.tsx를 토씨 하나 안 틀리고 그대로 이식(사용자 명시적
// 지시)으로 시작했으나, "Connected Apps"(YouTube 전용 확정 이후 무의미)와 "Platform Configuration"
// (Android/iOS 라벨만 다르고, 그 안의 오버레이 준비 상태는 Android Guard Services 패널의 "오버레이
// 상태" 행과 완전히 중복 — 2026-07-26 사장님 지시로 삭제)을 뺐다. 원본은 Session Defaults를 실제
// 세션과 무관한 로컬 데모 state로 관리했는데, Pace는 애초에 "기본값=실제 설정" 하나뿐이라
// useSettingsStore에 직접 연결(더 정확한 동작 — 죽은 데모 state를 만들지 않음). 언어 선택기와
// 구독/paywall 행은 Pace 자체 기능이라 유지(원본에 없음).
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useUserStore((s) => s.user);
  const logout = useUserStore((s) => s.logout);
  const deleteAccount = useUserStore((s) => s.deleteAccount);
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const isReviewer = useSubscriptionStore((s) => s.isReviewer);
  const adBannerHeight = useAdBannerStore((s) => s.height);
  const tabBarHeight = useAdBannerStore((s) => s.tabBarHeight);
  const { settings, update } = useSettingsStore();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showHelpCenter, setShowHelpCenter] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const bluetooth = useBluetoothStore();
  // 2026-07-20 실기기 감사 중 발견: "Platform Configuration" 카드의 READY 배지가 실제 오버레이
  // 권한 상태와 무관하게 항상 켜져 있었다(Dev Client 안 붙었거나 사용자가 권한을 거부해도 계속
  // READY라고 표시) — 실제 권한 상태로 교체. overlayReady는 Platform Configuration 배지와
  // 아래 Session Status/Android Guard Services 카드의 오버레이 상태 행이 공유(동일 권한이라
  // 별도 state로 이중 폴링할 필요 없음).
  const [overlayReady, setOverlayReady] = useState(false);
  const [hasUsageAccessPermission, setHasUsageAccessPermission] = useState(false);
  const [hasAutoNextPermission, setHasAutoNextPermission] = useState(false);
  const [hasBatteryExemption, setHasBatteryExemption] = useState(false);
  const [showAccessibilityOnboarding, setShowAccessibilityOnboarding] = useState(false);

  // 2026-07-22 사용자 지시 — Focus 탭의 "Session Status"/"Android Guard Services" 카드를 이 화면으로
  // 이전(포커스 탭에서 중복 삭제 지시에 준해 정리). 원래 focus.tsx에 있던 권한 폴링 로직 그대로
  // 이식 — 마운트 시 1회 + AppState 'active'(다른 화면에서 권한 부여하고 돌아올 때)마다 재조회.
  useEffect(() => {
    bluetooth.refresh();
    let cancelled = false;
    const check = async () => {
      const [overlay, usageAccess, autoNextPermission, batteryExemption] = await Promise.all([
        overlayService.hasOverlayPermission(),
        overlayService.hasForegroundDetectionPermission(),
        capabilities.supportsAutoNext ? autoNextService.hasPermission() : Promise.resolve(false),
        overlayService.hasBatteryOptimizationExemption(),
      ]);
      if (cancelled) return;
      setOverlayReady(overlay);
      setHasUsageAccessPermission(usageAccess);
      setHasBatteryExemption(batteryExemption);
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

  // 2026-07-27 사용자 지시("시간이나 다른 것들도 다 적용 안되는거 아냐? 전수 확인해") — 휴식 간격/
  // 알림 3종/Hard Block은 여태 세션 시작 시점 값만 네이티브에 넘어가서, 세션이 이미 도는 중에 이
  // 화면에서 바꿔도 다음 세션 시작 전까지 전혀 반영이 안 됐다(손짓/블루투스 볼륨키와 같은 종류의
  // 결함). update() 직후(Zustand set은 동기라 즉시 반영됨) 최신 settings를 네이티브로 즉시 push.
  const pushLiveSessionConfig = () => {
    if (Platform.OS !== 'android') return;
    const s = useSettingsStore.getState().settings;
    bluetoothService.updateLiveSessionConfig({
      breakIntervalMinutes: s.breakIntervalMinutes,
      notifyRemaining: s.notifyRemaining,
      notifyLimit: s.notifyLimit,
      notifyBreak: s.notifyBreak,
      hardBlockMode: s.hardBlockMode,
    }).catch(() => {});
  };

  // 2026-07-18: 알림 토글은 이전엔 화면 로컬 state라 탭을 벗어나면 항상 기본값으로 리셋되고 실제
  // 알림 발송 여부(services/notifications)에도 전혀 반영되지 않았다 — useSettingsStore에 직결해
  // ON을 켜면 requestNotificationPermission()도 즉시 트리거(권한이 없으면 알림이 안 갈 걸 미리 확인).
  const onToggleNotif = (key: 'notifyRemaining' | 'notifyLimit' | 'notifyBreak') => (value: boolean) => {
    update({ [key]: value });
    pushLiveSessionConfig();
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

  // Apple 5.1.1(v) — 계정 생성을 지원하면 앱 안에서 완전 삭제도 지원해야 함(단순 비활성화 불가).
  // deleteAccount()가 서버 계정(세션/설정 FK CASCADE 포함) + 로컬 인증/기록을 전부 지우고 게스트로
  // 되돌린다 — 실패 시(네트워크 등) 모달을 열어둔 채 에러만 보여주고 로컬 상태는 건드리지 않는다.
  const confirmDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await deleteAccount();
      setShowDeleteConfirm(false);
      router.replace('/(tabs)/home');
    } catch (e) {
      console.warn('[settings] delete account failed', e);
      Alert.alert(t('settings.deleteAccountErrorTitle'), t('settings.deleteAccountErrorMessage'));
    } finally {
      setIsDeletingAccount(false);
    }
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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + adBannerHeight }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>{t('settings.screenTitle')}</Text>

        {/* 1. Account */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.account')}</Text>
          <GlassSurface style={[styles.card, styles.singleCard, styles.accountCard]}>
            <View style={styles.accountLeft}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
              <View style={styles.accountInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.profileName} numberOfLines={1}>{name.toUpperCase()}</Text>
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
          {/* 2026-07-26 사용자 지시 — 게스트가 로그인 화면(구글/애플 소셜 로그인, src/app/auth)으로
              가는 직접 진입점이 Settings에 없어서, "구독 관리"를 눌러 paywall의 blockIfNotSignedIn에
              막혀야만 우회로 로그인 화면을 보게 되는 문제가 있었다 — 게스트에게 직접 로그인 버튼 노출. */}
          {user?.isGuest && (
            <Pressable style={styles.logoutRow} onPress={() => router.push('/auth')}>
              <Feather name="log-in" size={14} color="#818CF8" />
              <Text style={[styles.logoutRowText, { color: '#818CF8' }]}>{t('auth.title')}</Text>
            </Pressable>
          )}
          {/* 2026-07-20 실기기 감사 중 발견: logout()을 호출하는 UI가 이 화면 어디에도 없었다 —
              이전엔 "설정 초기화" 버튼 하나가 로그아웃까지 겸하고 있었는데(문구와 안 맞는 부작용),
              그걸 정직한 데이터 초기화로 고치면서 로그아웃할 방법 자체가 사라질 뻔했다. 게스트는
              로그아웃할 실제 계정이 없으므로 로그인된 사용자에게만 노출. 2026-07-31 사용자 지적
              ("두 줄 다 빨간색이 트렌드야?") — 로그아웃은 되돌릴 수 있는 안전한 동작이라 danger색을
              빼고 중립색으로 변경(진짜 위험한 동작인 "계정 삭제"만 danger색으로 구분되게). 계정 삭제
              자체는 jlpt-master 패턴을 따라 아래 "8. Advanced" 섹션의 메뉴 행으로 이전(사용자 지시). */}
          {!user?.isGuest && (
            <Pressable style={styles.logoutRow} onPress={logout}>
              <Feather name="log-out" size={14} color={colors.textSecondary} />
              <Text style={[styles.logoutRowText, { color: colors.textSecondary }]}>{t('settings.logout')}</Text>
            </Pressable>
          )}
        </View>

        {/* 2026-07-27 사용자 지시로 Weekly Attendance는 Focus 탭으로 이동(focus.tsx 참고) — 설정값이
            아니라 "매일 확인하는 상태/습관 기록"이라 Settings보다 Focus의 실시간 상태 성격에 더 맞음. */}

        {/* 2. Session Length — 2026-07-27 사용자 지시: 기존 "기본 세션 설정" 5개 항목이 한 카드에
            몰려있고 특히 "Sleep Timer"/"Advanced Sleep Mode"가 이름만 봐선 뭐가 다른지 구분이
            안 된다는 지적으로 "얼마나 볼 수 있는지"(세션 길이) / "언제 알려주고 멈출지"(휴식 & 수면
            감지) 두 카드로 재구성. */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.sessionLength')}</Text>
          <GlassSurface style={styles.card}>
            <DefaultRow
              title={t('settings.focusSessionDuration')}
              desc={isPremium ? t('settings.focusSessionDurationDesc') : t('settings.focusSessionDurationDescFree')}
              value={`${settings.focusSessionDurationMinutes}m`}
              onPress={() => {
                // 2026-07-26 사용자 지시("무료일땐 10분 fix") — 무료는 값을 못 바꾸고 프리미엄
                // 화면으로 안내(_layout.tsx의 enforceFreeFocusSessionDuration이 10분으로 계속
                // 되돌려두므로, 여기서 cycle을 허용해도 다음 앱 재시작/구독상태 변화 때 무의미해짐 —
                // 애초에 탭 자체를 다르게 처리해 혼란을 없앤다).
                if (!isPremium) {
                  router.push('/paywall');
                  return;
                }
                const next = cycle(FOCUS_SESSION_DURATION_OPTIONS, settings.focusSessionDurationMinutes);
                update({ focusSessionDurationMinutes: next });
                // Android만 실제 효과 있음(네이티브 Kotlin 자동 종료 타이머가 이 미러 값을 직접
                // 읽음) — iOS는 bluetoothService.ios.ts에서 no-op이라 안전하게 무시됨.
                if (Platform.OS === 'android') bluetooth.setFocusSessionDurationMinutes(next);
              }}
            />
            <DefaultRow
              title={t('settings.defaultLimit')} desc={t('settings.defaultLimitDesc')}
              value={`${settings.dailyLimitMinutes}m`} bordered
              onPress={() => {
                const nextLimit = cycle(DAILY_LIMIT_OPTIONS, settings.dailyLimitMinutes);
                update({ dailyLimitMinutes: nextLimit });
                // 2026-07-27 사용자 지시 — 일일 제한도 같은 결함(세션 도중 바꿔도 다음 세션까지 반영
                // 안 됨). 이미 존재하는 updateRemaining()(연장 시간에서 쓰는 경로와 동일)을 재사용해
                // "새 한도 + 오늘 보너스 - 오늘 사용량"으로 즉시 다시 계산해 넘긴다.
                if (Platform.OS === 'android') {
                  const bonus = useDailyBonusStore.getState().extraMinutes;
                  const used = useStatsStore.getState().todayUsageMinutes;
                  const newRemaining = Math.max(0, nextLimit + bonus - used);
                  overlayService.updateRemaining(newRemaining).catch(() => {});
                }
              }}
            />
          </GlassSurface>
        </View>

        {/* 2.5 Breaks & Sleep Detection — 취침 타이머(수동 카운트다운)와 수면 감지 민감도(자동
            무진동 감지)는 이름이 비슷해 보여도 서로 다른 메커니즘이라, 같은 카드 안에서도 순서상
            바로 붙여 나란히 비교되게 배치. */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.remindersAndSleep')}</Text>
          <GlassSurface style={styles.card}>
            <DefaultRow
              title={t('settings.defaultBreak')} desc={t('settings.defaultBreakDesc')}
              value={settings.breakIntervalMinutes ? `${settings.breakIntervalMinutes}m` : t('focus.off')}
              onPress={() => { update({ breakIntervalMinutes: cycle(BREAK_OPTIONS, settings.breakIntervalMinutes) }); pushLiveSessionConfig(); }}
            />
            <DefaultRow
              title={t('settings.defaultSleep')} desc={t('settings.defaultSleepDesc')}
              value={settings.sleepTimerMinutes ? `${settings.sleepTimerMinutes}m` : t('focus.off')} bordered
              onPress={() => {
                const nextTimer = cycle(SLEEP_TIMER_OPTIONS, settings.sleepTimerMinutes ?? 0) || null;
                update({ sleepTimerMinutes: nextTimer });
                if (Platform.OS === 'android') {
                  bluetoothService.setSleepTimerMinutes(nextTimer ?? 0).catch(() => {});
                }
              }}
            />
            <DefaultRow
              title={t('settings.sleepStillness')}
              desc={isPremium ? t('settings.sleepStillnessDesc') : t('settings.sleepStillnessDescFree')}
              value={`${settings.sleepStillnessMinutes}m`} bordered
              onPress={() => {
                // 2026-07-26 사장님 결정(D8) — 페이월이 광고하는 커스터마이즈 가능한 무진동 감지
                // 민감도의 실제 구현. 무료는 위 Focus Session Duration과 동일한 패턴으로 값을 못
                // 바꾸고 페이월로 안내(_layout.tsx의 enforceFreeFocusSessionDuration이
                // sleepStillnessMinutes도 10으로 계속 되돌림).
                if (!isPremium) {
                  router.push('/paywall');
                  return;
                }
                const nextStillness = cycle(SLEEP_STILLNESS_OPTIONS, settings.sleepStillnessMinutes);
                update({ sleepStillnessMinutes: nextStillness });
                // 2026-07-27 감사 발견 — setSleepStillnessMinutes는 세션 시작 시점 값이 아니라
                // performTick()이 매 틱마다 다시 읽는 라이브 인스턴스 필드(_layout.tsx의 프리미엄→무료
                // 강제 다운그레이드 경로가 이미 이 함수로 즉시 반영되고 있었다)라, 사용자가 직접 바꿀
                // 때도 다음 세션까지 기다릴 이유가 없다 — 같은 함수를 여기서도 호출해 즉시 반영.
                if (Platform.OS === 'android') bluetoothService.setSleepStillnessMinutes(nextStillness).catch(() => {});
              }}
            />
          </GlassSurface>
        </View>

        {/* 2026-07-27 사용자 지시 — 볼륨키/블루투스 토글은 Focus 탭 핸즈프리 섹션(마스터+손짓+블루투스)으로 이전. */}

        {/* 2026-07-27 사용자 지적("세션 상태 박스 남은시간이 왜 0이야") — 이 카드의 remainingMinutes는
            진짜 실시간 세션 카운트다운이 아니라 "일일한도+보너스-오늘사용량"을 매번 새로 계산한 값이라
            (settings.tsx 상단 참고), 테스트로 오늘 사용량이 한도를 넘긴 뒤로는 실제 세션이 몇 분 남았든
            항상 0으로 보였다 — Focus 탭에 이미 진짜 실시간 상태 히어로 카드가 따로 있어 완전히 중복이기도
            했다. 잘못된 값을 보여주느니 지우는 게 낫다고 판단해 제거 — 실시간 세션 상태는 Focus 탭 참고. */}

        {/* 5. Notifications — 2026-07-27 사용자 지시로 limitAlert/breakReminder 알림 토글 제거.
            notifyLimit은 한도 도달 시 항상 뜨는 전체화면 차단(옵트아웃 불가)과 중복이었고,
            notifyBreak은 위 "Breaks & Sleep Detection"의 간격 설정(0=OFF)과 같은 걸 두 번 끄고
            켜는 이중 스위치라 혼란만 줬다. notifyRemaining(남은시간 알림)만 다른 곳에 없는 정보라 유지 —
            settings.notifyLimit/notifyBreak 필드 자체는 DB/타입에 남아있지만(다른 기존 세션 마이그레이션
            영향 없게) UI에서만 제거, 네이티브는 이미 값이 있으면 그대로 존중하므로 무해. */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.notifications')}</Text>
          <GlassSurface style={styles.card}>
            <NotifRow title={t('settings.remainingAlert')} desc={t('settings.remainingAlertDesc')} value={settings.notifyRemaining} onChange={onToggleNotif('notifyRemaining')} />
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
                onChange={(value) => { update({ hardBlockMode: value }); pushLiveSessionConfig(); }}
              />
            </GlassSurface>
          </View>
        )}

        {/* 2026-07-27 사용자 지시로 Bluetooth Volume-Key Skip 토글을 Focus 탭 핸즈프리 섹션(마스터+손짓+블루투스)
            으로 이전 — 설정/집중에 흩어져 있던 걸 집중 한 곳으로 통합. Android는 여기서 bluetoothVolumeKeySkipEnabled를
            그 섹션의 "블루투스 리모컨" 하위 토글이 읽고 쓴다. */}

        {/* 5.7 Playback Controls(2026-07-19, 사용자 지시 — Bluetooth Hands-Free) */}
        {/* 2026-07-27: iOS에선 이 "블루투스 기기 연결 상태" 섹션을 숨김 — bluetoothService.ios.ts가 no-op
            스텁이라 항상 "Not Connected"로만 떠 오해를 준다. iOS 핸즈프리는 블루투스 페어링이 아니라 피드
            안의 손짓(카메라)/볼륨키(useFeedRemoteControl.ios)라 그 안내는 온보딩 Hands-Free 가이드가 담당. */}
        {capabilities.supportsHandsFreeControl && Platform.OS !== 'ios' && (
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
            {/* App Store Guideline 5.1.1(i) — 계정 생성 앱은 개인정보처리방침 링크가 앱 내에 있어야 한다. */}
            <ChevronRow title={t('settings.privacyPolicy')} bordered onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})} />
            <ChevronRow title={t('settings.rateApp')} bordered onPress={handleRateApp} />
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.versionLabel}>{t('settings.version')}</Text>
              <Text style={styles.versionValue}>{Constants.expoConfig?.version ?? '1.0.1'}</Text>
            </View>
          </GlassSurface>
        </View>

        {/* 8. Advanced — Reset + Delete Account */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.advanced')}</Text>
          <GlassSurface style={styles.card}>
            <View style={styles.advancedCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resetTitle}>{t('settings.resetSettings')}</Text>
                <Text style={styles.rowSubtitle}>{t('settings.resetSettingsDesc')}</Text>
              </View>
              <Pressable style={styles.resetIconBtn} onPress={() => setShowResetConfirm(true)}>
                <Feather name="refresh-cw" size={16} color={colors.dangerLight} />
              </Pressable>
            </View>
            {/* 2026-07-31 App Store 심사 반려(Guideline 5.1.1(v)) 대응, 사용자 지시로 jlpt-master
                패턴 그대로 이식 — 계정 관리(로그인/로그아웃)와 분리해 "고급" 섹션의 메뉴 행으로 배치.
                게스트는 실제로 만든 계정이 없어 게이팅(로그아웃과 동일 기준). Reset Settings보다
                되돌릴 수 없는 더 심각한 동작이라 dangerLight 대신 진한 danger색으로 구분. */}
            {!user?.isGuest && (
              <View style={[styles.advancedCard, styles.rowBordered]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deleteAccountTitle}>{t('settings.deleteAccount')}</Text>
                  <Text style={styles.rowSubtitle}>{t('settings.deleteAccountDesc')}</Text>
                </View>
                <Pressable style={styles.deleteAccountIconBtn} onPress={() => setShowDeleteConfirm(true)}>
                  <Feather name="trash-2" size={16} color={colors.danger} />
                </Pressable>
              </View>
            )}
          </GlassSurface>
        </View>

        {/* 9. Android Guard Services — 2026-07-27 사용자 지시: 일반 사용자에게 계속 노출할 만큼
            자주 손댈 일이 없는 디버그 패널이라 판단, 맨 아래로 내리고 __DEV__(상용 빌드 제외)로
            숨김. 다만 기능 자체(권한 재요청)는 그대로 남겨둠 — 오늘 밤 오버레이/손짓/서비스
            소실 사고가 전부 이 권한들(오버레이/접근성/배터리 최적화)이 조용히 꺼진 게 원인이었어서,
            개발 중 재현/복구용으로는 여전히 필요함. */}
        {__DEV__ && Platform.OS === 'android' && (
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
              {/* 2026-07-26 사용자 지시(외부 AI 조언 반영) — 삼성 One UI가 접근성/오버레이/사용정보
                  접근을 배터리 최적화로 조용히 회수하는 걸 이번 세션 내내 겪었다. "배터리 사용량
                  최적화 제외"를 받아두면 회수 빈도가 줄어든다 — 위 세 행과 같은 guardRow 패턴. */}
              <Pressable
                style={[styles.guardRow, styles.guardRowBordered]}
                onPress={() => !hasBatteryExemption && overlayService.requestBatteryOptimizationExemption()}
              >
                <View style={styles.guardLeft}>
                  <Text style={styles.statusTitleSm}>{t('focus.batteryStatus')}</Text>
                  <Text style={styles.guardDesc}>{t('focus.batteryStatusDesc')}</Text>
                </View>
                <View style={[styles.pulsePill, !hasBatteryExemption && styles.pulsePillWarning]}>
                  <View style={[styles.pulseDot, !hasBatteryExemption && styles.pulseDotWarning]} />
                  <Text style={[styles.pulsePillText, !hasBatteryExemption && styles.pulsePillTextWarning]}>
                    {hasBatteryExemption ? t('focus.running') : t('focus.permissionNeeded')}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      <Modal visible={showResetConfirm} transparent animationType="fade" onRequestClose={() => setShowResetConfirm(false)} statusBarTranslucent navigationBarTranslucent>
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

      {/* 2026-07-31 App Store 심사 반려(5.1.1(v)) 대응 — 계정 삭제 확인 모달. Apple이 명시적으로
          허용하는 "실수 방지용 확인 단계"라 바로 지우지 않고 한 번 더 확인시킨다. */}
      <Modal visible={showDeleteConfirm} transparent animationType="fade" onRequestClose={() => !isDeletingAccount && setShowDeleteConfirm(false)} statusBarTranslucent navigationBarTranslucent>
        <View style={[styles.modalBackdrop, { paddingBottom: bottomSheetPadding(insets.bottom) }]}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('settings.deleteAccountConfirmTitle')}</Text>
            <Text style={styles.modalBody}>{t('settings.deleteAccountConfirmMessage')}</Text>
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => setShowDeleteConfirm(false)} style={styles.modalSecondaryBtn} disabled={isDeletingAccount}>
                <Text style={styles.modalSecondaryBtnText}>{t('settings.cancel')}</Text>
              </Pressable>
              <Pressable onPress={confirmDeleteAccount} style={styles.modalDangerBtn} disabled={isDeletingAccount}>
                <Text style={styles.modalPrimaryBtnText}>{isDeletingAccount ? t('settings.deleteAccountInProgress') : t('settings.deleteAccountNow')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 2026-07-21 밤 감사 발견 — Help Center 행이 onPress 자체가 없어 완전히 죽어있었다. 백엔드/CMS가
          없어 외부 지원 페이지로 연결할 수 없으므로, 핵심 기능 FAQ를 앱 안에 직접 담아 최소한의
          실질적 도움을 준다. */}
      <Modal visible={showHelpCenter} transparent animationType="slide" onRequestClose={() => setShowHelpCenter(false)} statusBarTranslucent navigationBarTranslucent>
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
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg },
  screenTitle: { fontSize: 24, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  sectionLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  // App.tsx SettingsTab.tsx 전 섹션이 카드에 p-5/px-5(20px)를 쓰는데 spacing.lg(24px)로 잘못
  // 이식돼 있었다. 리스트형 카드(divide-y)는 각 행이 자체 py-4(16px)로 세로 여백을 담당하므로
  // 카드 자체엔 세로 패딩을 안 준다 — Account/Platform/Advanced처럼 단일 콘텐츠 카드만
  // paddingVertical 20을 별도로 추가(singleCard). 테두리도 구분선(0.04)과 다른 0.05로 분리.
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', borderRadius: radius.card, paddingHorizontal: 20 },
  singleCard: { paddingVertical: 20 },
  accountCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, flex: 1, minWidth: 0 },
  accountInfo: { flexShrink: 1, minWidth: 0 },
  avatar: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontFamily: typography.displayFontFamily, fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  profileName: { fontSize: 16, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, letterSpacing: -0.2, flexShrink: 1 },
  premiumTag: { backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  premiumTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.primary, letterSpacing: 0.5 },
  profileEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontFamily: typography.bodyFontFamilyMedium },
  manageSubBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: spacing.sm },
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
  // Reset Settings보다 심각도가 높은 동작이라 dangerLight 대신 진한 danger 톤으로 구분.
  deleteAccountTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.danger },
  deleteAccountIconBtn: { width: 36, height: 36, borderRadius: radius.chip, backgroundColor: colors.dangerBg, alignItems: 'center', justifyContent: 'center' },

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
