import { useCallback, useEffect, useState } from 'react';
import { AppState, Image, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useUserStore } from '../../store/useUserStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { bluetoothService, autoNextService } from '../../services/platform';
import { useToastStore } from '../../store/useToastStore';
import { useAttendanceStore, getLast7Days, getCurrentStreak } from '../../store/useAttendanceStore';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { AppHeader } from '../../components/ui/AppHeader';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { GestureFlickIllustration } from '../../components/home/GestureFlickIllustration';
import { RemoteClickIllustration } from '../../components/home/RemoteClickIllustration';
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { getSavedVideos, removeSavedVideo, type SavedVideo, type SavedVideoKind } from '../../database/repositories/savedVideosRepository';

// getLast7Days()(useAttendanceStore, 순수 함수라 t() 접근 불가)가 넘겨주는 dayIndex(0=일~6=토,
// Date.getDay()와 동일)를 실제 번역 키로 매핑 — settings.tsx에서 그대로 가져옴(2026-07-27, Weekly
// Attendance를 Focus 탭으로 이동).
const DAY_INDEX_KEYS: TranslationKey[] = [
  'stats.daySun', 'stats.dayMon', 'stats.dayTue', 'stats.dayWed', 'stats.dayThu', 'stats.dayFri', 'stats.daySat',
];

// healthy-shorts-assistant(2) SettingsSection.tsx(Focus 탭)를 토씨 하나 안 틀리고 그대로 이식
// (사용자 명시적 지시)으로 시작했으나, 2026-07-22 사용자 지시로 여러 차례 단순화됨 — Session
// Status/Android Guard Services 카드는 Settings 화면으로 이전(settings.tsx 참고), Session Stats
// 3그리드는 분석(Stats) 탭과 중복이라 삭제, Hands-Free Control(Previous/Next/Auto Mode 버튼)과
// Session Controls(Auto Next 토글 + End Session 버튼, 딸린 Finish Session 확인 모달 포함)도 삭제
// — Focus 탭을 Session Control Hero → Extend Time → Interventions → (iOS)Pace Feed 진입만 남겨
// 단순화. 원본은 minutesWatched를 로컬 데모 state로 관리했는데, Pace는 실제 useStatsStore
// (todayUsageMinutes) 데이터로 대체했다 — "죽은 코드/가짜 데이터로 남기지 말라"는 별도 지시에 따름.
// Break Reminder/Healthy Pause 토글도 실제 useSettingsStore에 연결.
export default function FocusScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const adBannerHeight = useAdBannerStore((s) => s.height);
  const tabBarHeight = useAdBannerStore((s) => s.tabBarHeight);
  const { settings, update } = useSettingsStore();
  const { todayUsageMinutes, refresh } = useStatsStore();
  const { extraMinutes: bonusMinutes } = useDailyBonusStore();
  const attendanceHistory = useAttendanceStore((s) => s.history);
  const bonusCredits = useAttendanceStore((s) => s.bonusCredits);
  const currentStreak = getCurrentStreak(attendanceHistory);
  const autoModeEnabled = useBluetoothStore((s) => s.autoModeEnabled);
  const toggleAutoMode = useBluetoothStore((s) => s.toggleAutoMode);
  // 2026-07-27 사용자 지시 — "손짓/볼륨키/블루투스 핸즈프리" 상태를 Focus 탭에 모아서 보여달라는
  // 요청. 실제 실행 방식은 플랫폼마다 다르지만(Android=카메라 손짓+볼륨키, iOS=볼륨키+카메라 손짓,
  // PaceVolumeKeyModule.swift 참고 — 둘 다 진짜 블루투스 "페어링"은 아니고 볼륨 버튼 입력을 가로채는
  // 방식) 사용자에게 보여줄 개념은 "핸즈프리 켜져 있나"라는 마스터 스위치 하나로 동일하다.
  const handsFreeMethods = Platform.OS === 'android'
    ? t('focus.handsFreeMethodsAndroid')
    : t('focus.handsFreeMethodsIos');
  // 2026-07-27 사용자 지시 — 핸즈프리를 "마스터 + 손짓/블루투스 개별" 구조로 분리(마스터 OFF면 하위 숨김).
  // 손짓도 블루투스와 대칭으로 마스터와 완전히 독립된 자체 on/off를 갖는다(사용자 지적 "왜 손짓을
  // 빼니" — 이전엔 안드로이드만 네이티브가 마스터에 손짓을 번들해서 별도 행이 없었다. 이제
  // PaceOverlayService.setHandsFreeGestureEnabled()로 분리 — 마스터가 켜진 중에도 손짓만 따로
  // 끄고 켤 수 있고, 마스터를 다시 켜면 그 손짓 설정값을 그대로 존중한다).
  const isIOS = Platform.OS === 'ios';
  const masterOn = isIOS ? settings.handsFreeEnabled : autoModeEnabled;
  const setMaster = (v: boolean) => { if (isIOS) update({ handsFreeEnabled: v }); else onToggleHandsFree(); };
  // iOS 손짓은 카메라 권한 필요 — 거부(denied/restricted)면 토글이 켜져도 네이티브가 조용히 no-op이라
  // "켠 것처럼 보이는데 안 됨"이 된다(사장님 지적). 권한 상태를 읽어 거부면 토글을 강제 OFF로 보여주고,
  // 켜려 하면 설정으로 다이렉트 링크(Linking.openSettings). notDetermined면 시스템 권한 프롬프트를 띄운다.
  const [camStatus, setCamStatus] = useState<string>('authorized');
  const gestureMod = isIOS ? requireOptionalNativeModule<{ cameraPermissionStatus(): string; requestCameraPermission(): Promise<boolean> }>('PaceGesture') : null;
  useEffect(() => {
    if (!isIOS || !gestureMod) return;
    const check = () => { try { setCamStatus(gestureMod.cameraPermissionStatus()); } catch {} };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); }); // 설정에서 돌아오면 재확인
    return () => sub.remove();
  }, []);
  const camDenied = isIOS && (camStatus === 'denied' || camStatus === 'restricted');
  const gestureOn = settings.handsFreeGesture && !camDenied; // 권한 거부면 무조건 OFF 표시
  const setGesture = (v: boolean) => {
    if (isIOS) {
      if (v && gestureMod) {
        // 2026-08-01 크래시 감사 F3 — :78과 달리 여기 sync 네이티브 호출이 try/catch 없이 탭 핸들러
        // 안에서 돌아, 바이너리 불일치 등으로 throw하면 크래시. 위와 동일하게 방어(실패 시 미결정 취급).
        let st: string;
        try { st = gestureMod.cameraPermissionStatus(); } catch { st = 'notDetermined'; }
        if (st === 'denied' || st === 'restricted') { setCamStatus(st); Linking.openSettings().catch(() => {}); return; } // 설정으로
        if (st === 'notDetermined') {
          gestureMod.requestCameraPermission().then((granted) => {
            setCamStatus(granted ? 'authorized' : 'denied');
            if (granted) update({ handsFreeGesture: true });
          }).catch(() => {});
          return;
        }
      }
      update({ handsFreeGesture: v });
      return;
    }
    update({ handsFreeGesture: v });
    // 2026-07-28 감사 발견 — 마스터 토글(toggleAutoMode/enableAutoModeForSession)은 켤 때 카메라 권한을
    // 미리 요청하는데, 이 손짓 하위토글은 마스터와 독립적으로 켤 수 있게 분리된 뒤(2026-07-27)로도 권한
    // 요청 코드가 없었다 — 카메라 권한을 한 번도 안 준 기기에서 이 스위치만 켜면 JS는 ON으로 보이는데
    // 네이티브 PaceHandWaveDetector.start()는 조용히 no-op(마스터와 동일한 "보이는데 안 됨" 버그).
    if (v) {
      (async () => {
        const hasCamera = await bluetoothService.hasCameraPermission();
        if (!hasCamera) await bluetoothService.requestCameraPermission().catch(() => false);
        bluetoothService.setHandsFreeGestureEnabled(v).catch(() => {});
      })();
      return;
    }
    bluetoothService.setHandsFreeGestureEnabled(v).catch(() => {});
  };
  const volumeSkipOn = isIOS ? settings.volumeKeyRemote : settings.bluetoothVolumeKeySkipEnabled;
  const setVolumeSkip = (v: boolean) => {
    update(isIOS ? { volumeKeyRemote: v } : { bluetoothVolumeKeySkipEnabled: v });
    // 2026-07-27 사용자 실기기 지적("핸즈프리 켰는데 블루투스 여전히 안 됨") — 예전엔 settings만
    // 바꿔서 다음 세션 시작(startSession의 bluetoothVolumeKeySkipEnabled) 전까지 이미 도는 세션엔
    // 전혀 반영이 안 됐다. 손짓(setHandsFreeGestureEnabled)과 동일하게 네이티브 플래그를 즉시 갱신.
    if (!isIOS) bluetoothService.setBluetoothVolumeKeySkipEnabled(v).catch(() => {});
  };
  // 감사 발견 subscription-C1(2026-07-27) — 핸즈프리는 D9 결정 번복으로 "무료 개방"됐다(home.tsx는
  // 세션 시작 시 무료로 auto-mode를 켜고, paywall도 benefitRemoteControl를 이미 제거). 그런데 여기 focus.tsx만
  // 프리미엄 게이팅이 남아, home에서 무료로 켜진 auto-mode를 free 사용자가 Focus 탭에서 "끄려고" 탭하면
  // 페이월로 튕겨 끌 수조차 없는 함정이었다. D9 무료정책에 맞춰 게이트 제거(공용코드 — Android도 동일 적용).
  const onToggleHandsFree = () => { toggleAutoMode(); };

  // 2026-07-28 사장님 지시("권한 설정을 안했을 때 관련 메뉴들이 disable로 보여야 한다") — 손짓/블루투스
  // 토글이 이전엔 실제 권한 상태와 무관하게 항상 눌리는 것처럼 보였다(눌러도 조용히 안 먹힘, 오늘 밤
  // 반복된 "보이는데 안 됨" 버그 계열). 탭에 포커스될 때마다 실제 권한을 다시 확인해 없으면 흐리게
  // 표시하고, 탭하면 설정 대신 권한 재요청/설정화면으로 보낸다.
  const [hasAccessibility, setHasAccessibility] = useState(true);
  const [hasCameraPerm, setHasCameraPerm] = useState(true);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      autoNextService.hasPermission().then(setHasAccessibility).catch(() => {});
      bluetoothService.hasCameraPermission().then(setHasCameraPerm).catch(() => {});
    }, [])
  );
  // 실제 스와이프(dispatchGesture)는 결국 접근성 서비스를 거쳐야 하므로(PaceAccessibilityService.
  // swipeOnce), 손짓/블루투스 둘 다 접근성이 꺼져 있으면 무력화된다 — 손짓은 카메라 권한도 추가로 필요.
  const gestureBlocked = !isIOS && (!hasAccessibility || !hasCameraPerm);
  const bluetoothBlocked = !isIOS && !hasAccessibility;

  // 2026-07-31 사장님 지시 — 오버레이 P 메뉴의 Saved/Favorite은 앱을 벗어나지 않는 네이티브
  // 창이라 앱 안에서는 그 결과를 확인할 방법이 없었다("앱안에 메뉴와 리스트를 만들라고 했는데
  // 왜 아무 메뉴가 없어"). 같은 saved_videos 테이블을 여기서도 그대로 읽어 보여준다 — 이 화면은
  // 일반 RN 컨텍스트(브릿지 항상 살아있음)라 오버레이처럼 네이티브 SQLite 직접 접근이 필요 없고
  // 기존 savedVideosRepository를 그대로 쓴다. 탭에 포커스될 때마다 다시 불러와 오버레이에서
  // 방금 추가한 항목도 바로 반영되게 한다.
  // 2026-08-01 사장님 지시 — Saved/Favorite은 사실상 같은 기능이라 Favorite 하나로 통합(오버레이
  // P메뉴와 동일). getSavedVideos가 kind='favorite' 조회 시 예전 'capture' 데이터도 같이 읽어온다.
  const savedKind: SavedVideoKind = 'favorite';
  const [savedItems, setSavedItems] = useState<SavedVideo[]>([]);
  const reloadSavedItems = useCallback(() => {
    if (!user?.id) return;
    getSavedVideos(user.id, savedKind).then(setSavedItems).catch(() => setSavedItems([]));
  }, [user?.id]);
  useFocusEffect(useCallback(() => { reloadSavedItems(); }, [reloadSavedItems]));
  const onRemoveSaved = useCallback((id: string) => {
    setSavedItems((prev) => prev.filter((v) => v.id !== id));
    removeSavedVideo(id).catch(() => {});
  }, []);
  const onShareSaved = useCallback((item: SavedVideo) => {
    if (!item.url) return;
    Share.share({ message: item.url, url: item.url }).catch(() => {});
  }, []);
  const onOpenSaved = useCallback((item: SavedVideo) => {
    if (!item.url) return;
    Linking.openURL(item.url).catch(() => {});
  }, []);
  const explainAndOpenSettings = async (reason: 'camera' | 'accessibility') => {
    if (reason === 'accessibility') {
      useToastStore.getState().show(t('focus.accessibilityNeededToast'));
      await autoNextService.requestPermission();
      return;
    }
    useToastStore.getState().show(t('focus.cameraNeededToast'));
    const granted = await bluetoothService.hasCameraPermission();
    if (!granted) {
      await bluetoothService.requestCameraPermission().catch(() => false);
      const grantedAfter = await bluetoothService.hasCameraPermission().catch(() => false);
      // 이미 한 번 거부해서 OS가 다이얼로그를 다시 안 띄워주는 경우(permanently denied) — 시스템
      // 앱 설정 화면으로 직접 보낸다. requestCameraPermission이 즉시 false로 끝나면 그 신호로 판단.
      if (!grantedAfter) Linking.openSettings().catch(() => {});
    }
    setHasCameraPerm(await bluetoothService.hasCameraPermission().catch(() => false));
  };

  useEffect(() => {
    if (user?.id) refresh(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refresh]);

  // 2026-07-18 버그 수정: Extend Time(+10/20/30m)이 예전엔 settings.dailyLimitMinutes를 직접 올려버려서
  // "오늘만" 늘려주려던 의도와 달리 다음날 이후에도 영구히 늘어난 한도가 유지됐다. 이제 오늘 하루치
  // 보너스(useDailyBonusStore, 날짜 바뀌면 자동 리셋)를 더해서만 계산 — 영속 설정 자체는 안 건드린다.
  const effectiveDailyLimitMinutes = settings.dailyLimitMinutes + bonusMinutes;
  const remainingMinutes = Math.max(0, effectiveDailyLimitMinutes - todayUsageMinutes);
  const progressPct = Math.min(100, (todayUsageMinutes / Math.max(1, effectiveDailyLimitMinutes)) * 100);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AppHeader userEmail={user?.email ?? 'guest@pace.app'} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + adBannerHeight }]} showsVerticalScrollIndicator={false}>
        {/* 1. Session Control Hero */}
        <LinearGradient colors={['#1A1D26', colors.cardDeep]} style={styles.heroCard}>
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Text style={styles.liveTagText}>{t('focus.liveEngine')}</Text>
          </View>
          <Text style={styles.heroLabel}>{t('focus.focusSession')}</Text>
          <Text style={styles.heroTitle}>YouTube</Text>

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

        {/* 2026-07-27 사용자 지시로 Settings에서 이동 — 설정값이 아니라 "매일 확인하는 상태/습관
            기록"이라 Focus의 실시간 상태 성격에 더 맞음(원래 2026-07-26에 Settings에 추가됐던 것,
            스트릭 숫자 강조 + 연속된 날끼리 이어지는 선의 Duolingo류 스트릭 UI 패턴). */}
        <View>
          <Text style={styles.sectionLabel}>{t('settings.weeklyAttendance')}</Text>
          <GlassSurface style={[styles.card, styles.attendanceCard]}>
            {currentStreak > 0 && (
              <View style={styles.attendanceStreakRow}>
                <Feather name="zap" size={14} color={colors.successLight} />
                <Text style={styles.attendanceStreakText}>{t('settings.attendanceStreak', { n: currentStreak })}</Text>
              </View>
            )}
            <View style={styles.attendanceRow}>
              {getLast7Days(attendanceHistory).map((day) => (
                <View key={day.date} style={styles.attendanceDay}>
                  <Text style={styles.attendanceDayLabel}>{t(DAY_INDEX_KEYS[day.dayIndex])}</Text>
                  <View style={styles.attendanceDotColumn}>
                    {/* 연속된 출석일끼리 칸 전체 폭의 바가 서로 맞닿아 하나의 선처럼 이어짐 —
                        빠진 날은 바 자체가 없어 그 지점에서 자연스럽게 끊김. */}
                    {day.attended && <View style={styles.attendanceConnector} />}
                    <View
                      style={[
                        styles.attendanceDot,
                        day.attended && styles.attendanceDotFilled,
                        day.isToday && styles.attendanceDotToday,
                      ]}
                    >
                      {day.attended && <Feather name="check" size={12} color="#0B0C0F" />}
                    </View>
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.attendanceFooter}>
              <Feather name="star" size={12} color={colors.successLight} />
              <Text style={styles.attendanceFooterText}>{t('settings.attendanceBonusCredits', { n: bonusCredits })}</Text>
            </View>
          </GlassSurface>
        </View>

        {/* 2026-07-27 사용자 지시 — "Extend Time"(+10/20/30m) 섹션 삭제. 코드 확인 결과 광고/프리미엄
            게이팅이 전혀 없는 useDailyBonusStore.addMinutes를 무제한으로 호출해, Daily Limit 자체를
            완전히 무력화하는 구멍이었다(LimitReachedOverlay의 광고 기반 +5분과 같은 저장소를 공짜로
            무한히 채울 수 있었음). Daily Limit을 늘리고 싶으면 Settings/Home에서 그 설정 자체를
            의식적으로 바꾸는 게 맞다는 판단 — bonusMinutes(광고로 받은 보너스)는 계산에 여전히
            반영되지만, 이 화면에서 직접 더하는 경로는 제거. */}

        {/* 3. Interventions & Shields */}
        {/* 2026-07-20 실기기 감사 중 발견(맥 세션 QA_ISSUES_2026-07-18.md #13) — "15분마다 작동"이
            하드코딩 라벨이라 실제 breakIntervalMinutes(기본 20분, Settings에서 10/20/30분 등으로
            변경 가능)와 어긋나 있었다. 게다가 여기서 토글을 켜면 실제 설정값과 무관하게 항상 15로
            덮어써서 값이 흐트러졌다 — 라벨을 실제값으로 표시하고, 토글 ON 시에도 기본값(20)으로
            통일해 최소한 다른 화면과 어긋나지 않게 정정. */}
        <GlassSurface style={styles.card}>
          <View style={styles.interventionRow}>
            <View>
              <Text style={styles.interventionTitle}>{t('focus.breakReminder')}</Text>
              <Text style={styles.interventionSub}>{t('focus.everyNMinutes', { n: settings.breakIntervalMinutes || DEFAULT_SETTINGS.breakIntervalMinutes })}</Text>
            </View>
            <Switch
              value={settings.breakIntervalMinutes > 0}
              onValueChange={(v) => {
                const nextInterval = v ? DEFAULT_SETTINGS.breakIntervalMinutes : 0;
                update({ breakIntervalMinutes: nextInterval });
                // 2026-07-27 감사 발견 — settings.tsx의 같은 필드(Breaks & Sleep Detection 카드)는
                // pushLiveSessionConfig()로 이미 도는 세션에 즉시 반영되도록 고쳐졌는데, 같은
                // breakIntervalMinutes를 바꾸는 이 화면의 스위치는 update()만 호출해 다음 세션까지
                // 반영이 안 되는 불일치가 있었다 — 같은 라이브 경로를 여기서도 호출해 통일.
                if (Platform.OS === 'android') {
                  const s = useSettingsStore.getState().settings;
                  bluetoothService.updateLiveSessionConfig({
                    breakIntervalMinutes: nextInterval,
                    notifyRemaining: s.notifyRemaining,
                    notifyLimit: s.notifyLimit,
                    notifyBreak: s.notifyBreak,
                    hardBlockMode: s.hardBlockMode,
                  }).catch(() => {});
                }
              }}
              trackColor={{ true: colors.primary, false: '#262626' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#262626"
            />
          </View>
        </GlassSurface>

        {/* 2026-07-27 사용자 지시 — 손짓/볼륨키/블루투스 리모컨 등 핸즈프리 관련 상태를 한곳에 모음.
            마스터 스위치는 useBluetoothStore.autoModeEnabled(네이티브 SharedPreferences와 동기화된
            실제 상태) — 켜면 두 입력 방식(제스처+볼륨키)이 함께 켜진다. 프리미엄 게이팅은
            home.tsx의 onSelectPlatform과 동일 기준(D9). */}
        <View>
          <Text style={styles.sectionLabel}>{t('focus.handsFreeSection')}</Text>
          {/* ⚠️ GlassSurface(BlurView)는 크기가 바뀌면 매 프레임 다시 블러해야 해서 "번쩍"인다(사용자 지적,
              이전 수정에서 확인). 그래서 블러 카드(마스터 행)는 항상 고정 크기로 두고, 진짜 아코디언 동작
              (사용자 지적 "아코디언으로 내려와야지")이 필요한 하위 손짓/블루투스 행은 블러 없는 별도 패널로
              분리한다 — 이 패널은 layout={LinearTransition}으로 부드럽게 늘어나고 줄어든다(블러가 없어
              매 프레임 다시 그릴 게 없으니 번쩍임 자체가 발생하지 않음). */}
          <GlassSurface style={styles.card}>
            <View style={styles.interventionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.interventionTitle}>{t('focus.handsFreeMode')}</Text>
                <Text style={styles.interventionSub}>{handsFreeMethods}</Text>
              </View>
              <Switch
                value={masterOn}
                onValueChange={setMaster}
                trackColor={{ true: colors.primary, false: '#262626' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#262626"
              />
            </View>
          </GlassSurface>
          {/* 2026-07-27 사용자 지시 — 핸즈프리를 "마스터 + 손짓/블루투스 개별"로 분리, 안드로이드도 iOS와
              동일하게 손짓 행을 보여준다(예전엔 안드로이드만 네이티브가 마스터에 손짓을 번들해서 숨겨져
              있었음 — 이제 PaceOverlayService.setHandsFreeGestureEnabled()로 완전히 독립). 마스터 OFF면
              패널 전체가 접힌다. 라벨/아이콘은 온보딩 가이드(handsFreeSheet)와 통일 — 손짓=
              handWaveLabel+GestureFlickIllustration, 블루투스=bluetoothRemoteLabel+RemoteClickIllustration. */}
          {/* 2026-07-28 사장님 지시("손짓이 너무 부정확해") — 정확도 문제로 블루투스 리모컨을 먼저(위)
              보여주고 추천 배지를 단다. 손짓은 그 아래로 내림(온보딩 가이드 순서 변경과 통일). */}
          <Animated.View layout={LinearTransition.duration(220)} style={styles.handsFreeExpandWrap}>
            {masterOn && (
              <Animated.View
                entering={FadeInDown.duration(180)}
                exiting={FadeOutUp.duration(160)}
                layout={LinearTransition.duration(180)}
                style={styles.handsFreeSubCard}
              >
                <View style={[styles.handsFreeIcon, bluetoothBlocked && styles.handsFreeRowBlocked]}><RemoteClickIllustration /></View>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.interventionTitle, bluetoothBlocked && styles.handsFreeRowBlocked]}>{t('handsFreeSheet.bluetoothRemoteLabel')}</Text>
                  {bluetoothBlocked ? (
                    <View style={styles.permissionNeededBadge}>
                      <Text style={styles.permissionNeededBadgeText}>{t('focus.permissionNeeded')}</Text>
                    </View>
                  ) : (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedBadgeText}>{t('handsFreeSheet.recommended')}</Text>
                    </View>
                  )}
                </View>
                <Switch
                  value={volumeSkipOn && !bluetoothBlocked}
                  onValueChange={(v) => (bluetoothBlocked ? explainAndOpenSettings('accessibility') : setVolumeSkip(v))}
                  trackColor={{ true: colors.primary, false: '#262626' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#262626"
                />
              </Animated.View>
            )}
            {masterOn && (
              <Animated.View
                entering={FadeInDown.duration(180).delay(40)}
                exiting={FadeOutUp.duration(160)}
                layout={LinearTransition.duration(180)}
                style={styles.handsFreeSubCard}
              >
                <View style={[styles.handsFreeIcon, gestureBlocked && styles.handsFreeRowBlocked]}><GestureFlickIllustration /></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.interventionTitle, gestureBlocked && styles.handsFreeRowBlocked]}>{t('handsFreeSheet.handWaveLabel')}</Text>
                    {gestureBlocked && (
                      <View style={styles.permissionNeededBadge}>
                        <Text style={styles.permissionNeededBadgeText}>{t('focus.permissionNeeded')}</Text>
                      </View>
                    )}
                  </View>
                  {camDenied && (
                    <Text onPress={() => Linking.openSettings().catch(() => {})} style={styles.camDeniedHint}>
                      {t('focus.cameraDeniedHint')}
                    </Text>
                  )}
                </View>
                <Switch
                  value={gestureOn && !gestureBlocked}
                  onValueChange={(v) => (gestureBlocked ? explainAndOpenSettings(!hasAccessibility ? 'accessibility' : 'camera') : setGesture(v))}
                  trackColor={{ true: colors.primary, false: '#262626' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#262626"
                />
              </Animated.View>
            )}
          </Animated.View>
        </View>

        {/* 2026-07-27 사용자 지시로 Pace Feed 진입 섹션 제거 — 홈의 YouTube 카드 탭이 이미 /feed로
            들어가므로(home.tsx, iOS) 집중화면의 진입 버튼은 중복이었다. dev Shorts POC 버튼도 함께 제거. */}

        <View>
          <Text style={styles.sectionLabel}>{t('overlay.favoriteListTitle')}</Text>
          <GlassSurface style={styles.card}>
            {savedItems.length === 0 ? (
              <Text style={styles.savedEmptyText}>{t('overlay.favoriteListEmpty')}</Text>
            ) : (
              savedItems.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.savedRow}
                  onPress={() => onOpenSaved(item)}
                >
                  {item.thumbnailUrl ? (
                    <Image source={{ uri: item.thumbnailUrl }} style={styles.savedThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.savedThumb, styles.savedThumbFallback]}>
                      <Feather name="film" size={16} color={colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.savedRowText}>
                    <Text style={styles.savedRowTitle} numberOfLines={2}>{item.title ?? '—'}</Text>
                    {!!item.channel && <Text style={styles.savedRowChannel} numberOfLines={1}>{item.channel}</Text>}
                  </View>
                  <Pressable onPress={() => onShareSaved(item)} hitSlop={8} style={styles.savedRowAction}>
                    <Feather name="share-2" size={16} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={() => onRemoveSaved(item.id)} hitSlop={8} style={styles.savedRowAction}>
                    <Feather name="x" size={16} color={colors.textSecondary} />
                  </Pressable>
                </Pressable>
              ))
            )}
          </GlassSurface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: spacing.lg },

  heroCard: { borderRadius: 30, padding: 24, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  liveTag: { position: 'absolute', top: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: '#A5B4FC', letterSpacing: 0.5, textTransform: 'uppercase' },
  recommendedBadge: { backgroundColor: `${colors.successLight}26`, borderWidth: 1, borderColor: `${colors.successLight}4D`, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  recommendedBadgeText: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.successLight, letterSpacing: 0.4, textTransform: 'uppercase' },
  // 2026-07-28 사장님 지시 — 권한 없을 때 관련 토글을 흐리게(disable처럼 보이게) 표시.
  handsFreeRowBlocked: { opacity: 0.4 },
  permissionNeededBadge: { backgroundColor: `${colors.warning}26`, borderWidth: 1, borderColor: `${colors.warning}4D`, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  permissionNeededBadgeText: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.warning, letterSpacing: 0.4, textTransform: 'uppercase' },
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

  sectionLabel: { fontSize: 12, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.card, padding: spacing.lg, gap: spacing.sm },

  savedEmptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  savedThumb: { width: 48, height: 48, borderRadius: radius.card, backgroundColor: 'rgba(255,255,255,0.06)' },
  savedThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  savedRowText: { flex: 1, gap: 2 },
  savedRowTitle: { fontSize: 13, fontFamily: typography.bodyFontFamilySemibold, color: colors.textPrimary, lineHeight: 17 },
  savedRowChannel: { fontSize: 11, color: colors.textSecondary },
  savedRowAction: { padding: 6 },

  // 2026-07-27 Settings에서 이동 — 요일 7칸, 출석한 날은 채운 원+체크, 오늘은 테두리로 강조.
  // 하단에 누적 보너스 크레딧(useAttendanceStore.bonusCredits) 표시.
  attendanceCard: { paddingVertical: 20 },
  attendanceStreakRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  attendanceStreakText: { fontSize: 13, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  attendanceRow: { flexDirection: 'row', justifyContent: 'space-between' },
  attendanceDay: { alignItems: 'center', gap: 6, flex: 1 },
  attendanceDayLabel: { fontSize: 10, fontFamily: typography.bodyFontFamilySemibold, color: colors.textTertiary },
  attendanceDotColumn: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  attendanceConnector: { position: 'absolute', left: 0, right: 0, top: '50%', height: 2, marginTop: -1, backgroundColor: colors.successLight },
  attendanceDot: { width: 28, height: 28, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  attendanceDotFilled: { backgroundColor: colors.successLight, borderColor: colors.successLight },
  attendanceDotToday: { borderColor: colors.primary, borderWidth: 1.5 },
  attendanceFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  attendanceFooterText: { fontSize: 12, fontFamily: typography.bodyFontFamilySemibold, color: colors.textSecondary },

  interventionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  // 2026-07-27 — 블러 카드(마스터)와 분리된 진짜 아코디언 패널(사용자 지적 대응). handsFreeExpandWrap
  // 자체는 배경 없는 순수 레이아웃 컨테이너라 layout 애니메이션을 걸어도 블러 재계산이 없어 번쩍이지
  // 않는다 — 실제 카드 배경은 각 handsFreeSubCard가 개별로 갖는다(GlassSurface 아님, 평범한 View).
  handsFreeExpandWrap: { gap: spacing.xs, marginTop: spacing.xs },
  handsFreeSubCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.card,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  handsFreeIcon: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  interventionTitle: { fontSize: 14, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary },
  camDeniedHint: { fontSize: 11, fontFamily: typography.bodyFontFamilyMedium, color: colors.primary, marginTop: 2, textDecorationLine: 'underline' },
  interventionSub: { fontSize: 12, fontFamily: typography.bodyFontFamilyBold, color: '#818CF8', marginTop: 2 },
  premiumTag: { backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  premiumTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.primary, letterSpacing: 0.5 },
});
