import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';

// 🔴 2026-09-04 — 핸즈프리 하위 두 행도 행 전체를 탭 가능하게 만들기 위한 것(마스터 행 주석 참고).
//   Animated.View 는 onPress 를 받지 않으므로 Pressable 을 애니메이션 대상으로 감싼다 —
//   기존 entering/exiting/layout 애니메이션과 스타일은 그대로 유지된다.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../store/useSettingsStore';
import { useStatsStore } from '../../store/useStatsStore';
import { useUserStore } from '../../store/useUserStore';
import { useDailyBonusStore } from '../../store/useDailyBonusStore';
import { useBluetoothStore } from '../../store/useBluetoothStore';
import { bluetoothService, autoNextService, overlayService } from '../../services/platform';
import { useSessionStore } from '../../store/useSessionStore';
import { useToastStore } from '../../store/useToastStore';
import { diagLog } from '../../services/diagLog';
import { useAttendanceStore, getLast7Days, getCurrentStreak } from '../../store/useAttendanceStore';
import { useTranslation, type TranslationKey } from '../../services/i18n';
import { AppHeader } from '../../components/ui/AppHeader';
import { GlassSurface } from '../../components/ui/GlassSurface';
import { ConnectedDot } from '../../components/ui/ConnectedDot';
import { GestureFlickIllustration } from '../../components/home/GestureFlickIllustration';
import { RemoteClickIllustration } from '../../components/home/RemoteClickIllustration';
import { useAdBannerStore } from '../../store/useAdBannerStore';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { getSavedVideos, removeSavedVideo, type SavedVideo, type SavedVideoKind } from '../../database/repositories/savedVideosRepository';
import { AccessibilityOnboardingSheet } from '../../components/onboarding/AccessibilityOnboardingSheet';
import { GestureCalibrationSheet } from '../../components/gesture/GestureCalibrationSheet';
import { getSavedCalibration, isCalibrated } from '../../services/gestureCalibration';

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
  // Play 정책 고지·동의 시트(권한 요청 직전 인앱 고지) — 아래 liveTag onPress 주석 참고.
  const [showAccessibilityDisclosure, setShowAccessibilityDisclosure] = useState(false);
  const [camDisclosure, setCamDisclosure] = useState(false); // iOS 카메라 권한 거부 안내 팝업
  const { todayUsageMinutes, refresh } = useStatsStore();
  const { extraMinutes: bonusMinutes } = useDailyBonusStore();
  const attendanceHistory = useAttendanceStore((s) => s.history);
  const bonusCredits = useAttendanceStore((s) => s.bonusCredits);
  // 🔴 2026-08-13 실기기 발견 — 이 화면의 "실시간 추적 중" 배지가 **조건 없이 항상** 떠 있었다.
  //   접근성이 꺼져 추적이 반쪽인 상태에서도 초록불이라, **홈은 "추적이 꺼져 있어요"라고 하는데
  //   집중 탭은 "실시간 추적 중"이라고 하는** 정면 모순이 실기기에서 그대로 관측됐다.
  //   사용자는 둘 중 뭘 믿어야 할지 알 수 없고, 우리도 "왜 자동넘김이 안 되지?"의 원인을 못 짚는다.
  //   → 홈 배너와 **같은 진실원천**(overlayService.hasAccessibilityPermission)을 쓴다.
  // 지금 도는 세션의 플랫폼(없으면 null) — 히어로 제목이 이 값을 쓴다.
  const activePlatform = useSessionStore((s) => (s.status === 'running' ? s.platformApp : null));
  const [trackingLive, setTrackingLive] = useState(Platform.OS !== 'android');
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const check = () => {
      overlayService.hasAccessibilityPermission().then(setTrackingLive).catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);
  const currentStreak = getCurrentStreak(attendanceHistory);
  // 2026-08-13 — 블루투스 리모컨이 **실제로 연결돼 있는지** (기능 on/off와 별개). 아래 ConnectedDot.
  const isBluetoothConnected = useBluetoothStore((s) => s.isConnected);
  const refreshBluetooth = useBluetoothStore((s) => s.refresh);
  // 🔴 2026-08-14 사장님 지적("블루투스 리모컨 옆에 안드처럼 녹색불 만들었어? 제대로 동작해?") —
  //   isConnected는 useBluetoothStore.refresh()가 마지막으로 호출됐을 때의 스냅샷일 뿐이라(양
  //   플랫폼 다 getState()가 폴링식 조회지 연결변경 이벤트 구독이 아님 — bluetoothService.ios.ts /
  //   .android.ts 둘 다 동일 구조), home.tsx의 useFocusEffect가 Home 탭에 포커스될 때만 갱신했다.
  //   Focus 탭 자체는 refresh()를 한 번도 안 불러서, Home을 거치지 않고 바로 Focus로 들어오거나
  //   이 탭에 머무는 동안 이어폰을 붙였다 뗐다 해도 점이 그 순간을 절대 못 따라갔다(위 trackingLive와
  //   같은 클래스의 "표시가 진실과 따로 논다" 버그). 탭 포커스 시 즉시 1회 + 포커스 유지 중엔 짧은
  //   폴링으로 실제로 "살아있는" 표시가 되게 한다.
  useFocusEffect(
    useCallback(() => {
      refreshBluetooth();
      const id = setInterval(refreshBluetooth, 3000);
      return () => clearInterval(id);
    }, [refreshBluetooth])
  );
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
    try { diagLog('focus_cam', `cam=${gestureMod?.cameraPermissionStatus?.() ?? 'null'} mod=${gestureMod ? 1 : 0}`); } catch {}
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); }); // 설정에서 돌아오면 재확인
    return () => sub.remove();
  }, []);
  const camDenied = isIOS && (camStatus === 'denied' || camStatus === 'restricted');
  const gestureOn = settings.handsFreeGesture && !camDenied; // 권한 거부면 무조건 OFF 표시
  const setGesture = (v: boolean) => {
    if (isIOS) {
      // 끄는 건 항상 통과.
      if (!v) { update({ handsFreeGesture: false }); return; }
      // 🔴 2026-09-02 사장님("권한 껐다 토글해도 안내가 안 뜬다") — 방어적으로 재작성한다. 이전엔
      //   `if (v && gestureMod)`라 gestureMod가 없으면 분기를 통째로 건너뛰고 조용히 켜져 안내가 0이었다.
      //   이제 **켤 때 authorized가 아니면 어떤 경로든 반드시 안내**한다(설정 링크 또는 토스트).
      let st = 'notDetermined';
      try { st = gestureMod?.cameraPermissionStatus?.() ?? 'notDetermined'; } catch { st = 'notDetermined'; }
      if (st === 'authorized') { update({ handsFreeGesture: true }); return; }
      if (st === 'denied' || st === 'restricted') {
        // 🔴 2026-09-02 사장님("설명 팝업도 없이 그냥 설정으로 튄다") — 이미 거부된 권한은 iOS가
        //   앱 내 재요청을 막아 설정으로 가야만 켤 수 있다(그게 애플 제약). 하지만 **왜 가는지 설명하는
        //   팝업**을 먼저 띄운다(토스트+즉시 점프 대신). 사용자가 '설정 열기'를 눌러야만 이동한다.
        setCamStatus(st);
        setCamDisclosure(true);
        return;
      }
      // notDetermined — 시스템 프롬프트. 거부하면(또는 모듈 부재로 요청 불가) 반드시 안내한다.
      if (gestureMod?.requestCameraPermission) {
        gestureMod.requestCameraPermission().then((granted) => {
          setCamStatus(granted ? 'authorized' : 'denied');
          if (granted) update({ handsFreeGesture: true });
          else useToastStore.getState().show(t('focus.cameraNeededToast'));
        }).catch(() => { useToastStore.getState().show(t('focus.cameraNeededToast')); });
        return;
      }
      useToastStore.getState().show(t('focus.cameraNeededToast')); // 모듈 자체가 없다 — 켜지 않고 알린다.
      return;
    }
    // 2026-07-28 감사 발견 — 마스터 토글(toggleAutoMode/enableAutoModeForSession)은 켤 때 카메라 권한을
    // 미리 요청하는데, 이 손짓 하위토글은 마스터와 독립적으로 켤 수 있게 분리된 뒤(2026-07-27)로도 권한
    // 요청 코드가 없었다 — 카메라 권한을 한 번도 안 준 기기에서 이 스위치만 켜면 JS는 ON으로 보이는데
    // 네이티브 PaceHandWaveDetector.start()는 조용히 no-op(마스터와 동일한 "보이는데 안 됨" 버그).
    //
    // 🔴 2026-08-13 사장님 실기기 지적("손짓 토글하니까 권한설정 하나 제대로 안 된다") — 위 수정이
    //   **반쪽이었다.** 두 가지가 틀렸다:
    //     ① `update({ handsFreeGesture: v })`를 권한을 묻기 **전에** 무조건 실행 → 사용자가 권한을
    //        거부해도 **토글은 켜진 채로 남는다.**
    //     ② `requestCameraPermission()`이 granted(boolean)를 돌려주는데 **그 결과를 버렸다** →
    //        거부돼도 그대로 setHandsFreeGestureEnabled(true)를 불러 네이티브는 no-op.
    //   결국 고치겠다고 적어둔 "보이는데 안 됨"이 그대로 남아 있었다. iOS 경로는 camDenied로 강제
    //   OFF 표시까지 하는데 안드로이드만 그 처리가 통째로 없었다.
    // → 권한이 실제로 허용됐을 때만 켠다. 거부면 토글을 원래대로 되돌리고 사용자에게 이유를 알린다.
    if (!v) {
      update({ handsFreeGesture: false });
      bluetoothService.setHandsFreeGestureEnabled(false).catch(() => {});
      return;
    }
    (async () => {
      let granted = await bluetoothService.hasCameraPermission();
      if (!granted) granted = await bluetoothService.requestCameraPermission().catch(() => false);
      if (!granted) {
        // 켜지 않는다 — "켜진 것처럼 보이는데 안 되는" 상태를 만들지 않는 게 이 수정의 전부다.
        update({ handsFreeGesture: false });
        bluetoothService.setHandsFreeGestureEnabled(false).catch(() => {});
        useToastStore.getState().show(t('focus.cameraNeededToast'));
        return;
      }
      update({ handsFreeGesture: true });
      bluetoothService.setHandsFreeGestureEnabled(true).catch(() => {});
    })();
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

  // 행 전체 탭을 위해 인라인 핸들러를 추출(위 2026-09-04 주석과 같은 이유).
  const onBreakToggle = (v: boolean) => {
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
  };

  // 🔴 2026-09-04 사장님 지적("토글이 왜 누르면 아무 반응을 안 해? 끌어야만 하잖아") — 행 전체를
  //   탭 타겟으로 만들면서, 행의 onPress 와 스위치의 onValueChange 가 **같은 코드**를 타야 한다.
  //   예전엔 이 로직이 JSX 안에 인라인으로 있어 행에서 재사용할 수 없었다. 분기(잠김 여부, 권한
  //   안내 경로)가 두 벌이 되면 반드시 어긋나므로 함수로 모은다.
  const onBluetoothToggle = (v: boolean) => {
    if (!bluetoothBlocked) { setVolumeSkip(v); return; }
    if (v) pendingEnableRef.current = 'bluetooth';
    explainAndOpenSettings('accessibility');
  };
  const onGestureToggle = (v: boolean) => {
    if (!gestureBlocked) {
      setGesture(v);
      // 켜는 순간에만, 그리고 아직 보정한 적 없을 때만 띄운다. 끌 때는 묻지 않는다.
      // 🔴 2026-09-02 사장님("카메라 권한 켜져 있는데 자꾸 권한 켜기로 나온다") — 개인 보정은
      //   네이티브 함수(startGestureCalibration)가 **안드에만 있다**. iOS는 미구현이라
      //   startCalibration()이 항상 false→'denied'로 오판정돼 켤 때마다 권한 화면이 떴다.
      //   iOS 손짓은 자체 문턱으로 동작하고 이 보정값을 읽지도 않으므로 안드에서만 띄운다.
      // 🔴 2026-09-03 사장님 지시("보정은 한참 더 해봐야 할 거니까 입력 받는 거
      //   켜지 말고") — 출시본에서는 보정 시트를 띄우지 않는다.
      //   근거: 5번을 받아 만든 개인 문턱이 실제로 지배하는 축은 checkLumaPass
      //   **하나뿐**이다. 격자 모션 축은 GROSS_MOTION_STANDALONE=true 라
      //   보정값을 보지 않고 단독으로 발화한다(PaceHandWaveDetector.kt:812/2007).
      //   즉 지금 상태로는 "당신의 손짓을 기억합니다"라고 5번을 받아놓고 실제
      //   넘김의 상당수는 보정과 무관한 축에서 나온다 — 사용자에게 시간을
      //   요구하면서 그만큼 돌려주지 못한다. 격자 축까지 보정 대상에 넣거나
      //   문구를 실제 동작에 맞출 때까지 입력 자체를 받지 않는다.
      //   ⚠️ 저장된 값을 쓰는 경로(loadCalibration)는 그대로 둔다 — 이미 보정한
      //     사용자의 값을 버리지 않기 위해서다. 새로 묻지만 않는다.
      //   되살릴 때: 아래 한 줄의 주석을 풀면 된다(다른 변경 없음).
      // if (v && Platform.OS === 'android') getSavedCalibration().then((c) => { if (!isCalibrated(c)) setCalibVisible(true); }).catch(() => {});
      return;
    }
    // 위 pendingEnableRef 주석 참고 — 권한을 받으면 사용자가 원래 하려던 대로 켠다.
    if (v) pendingEnableRef.current = 'gesture';
    explainAndOpenSettings(!hasAccessibility ? 'accessibility' : 'camera');
  };

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
      // 🔴 2026-08-14 사장님 실기기 지적("bt 되는데 왜 블루투스 리모컨 옆에 초록불이 계속 회색이야?
      //   왜 블루투스 연결된 상태를 표시를 못하냐고") —
      //   **초록불을 그리는 이 화면이 정작 그 상태를 한 번도 안 읽고 있었다.**
      //   useBluetoothStore.refresh()를 부르는 곳은 home/settings/stats 셋뿐이고 focus만 빠져 있어서,
      //   집중 탭만 열면 스토어 초기값(isConnected: false)이 그대로 그려졌다 — 리모컨이 실제로
      //   동작하는데도 영원히 회색이다.
      //   ⚠️ 2026-08-13에 네이티브 판정(getBluetoothState)은 이미 고쳤다(HID 리모컨은 오디오 목록에
      //     안 잡히므로 "키를 보낸 적 있으면 연결"로 판정). 값은 맞게 나오는데 **읽는 쪽이 없었던**
      //     것이라, 그 수정만으로는 화면이 안 바뀌었다.
      //   포커스될 때마다 갱신한다(다른 탭들과 동일한 패턴).
      useBluetoothStore.getState().refresh().catch(() => {});
    }, [])
  );
  // 2026-08-01 사용자 지적("BT토글 누르면 접근성 화면 계속 온다고, 이미 사용중인데") — 위
  // useFocusEffect는 React Navigation의 화면 포커스에만 반응한다. 블루투스 토글을 눌러 시스템
  // 접근성 설정 화면(다른 Activity)으로 나갔다가 뒤로가기로 돌아오면, RN 내비게이터 입장에서는
  // Focus 탭이 애초에 블러된 적이 없어(같은 화면 스택 안에서 벗어난 적 없음, OS 레벨로만
  // pause/resume) useFocusEffect가 재실행되지 않는다 — hasAccessibility가 계속 예전(false)
  // 값에 멈춰 있어 이미 켰는데도 계속 "권한 필요"로 보이고 탭할 때마다 설정 화면이 다시 열렸다.
  // iOS의 카메라 권한 재확인(위 :80, "설정에서 돌아오면 재확인")과 동일한 패턴 — 앱이 다시
  // active로 돌아올 때도 재확인한다.
  // 🔴 2026-08-13 밤 사장님 실기기 신고("손짓 토글하고 앱 사용 중만 선택했는데 손짓 활성화 안 돼") —
  //   토글을 탭한 그 순간에는 아직 권한이 없어서 아래 onValueChange가 setGesture(v) 대신
  //   explainAndOpenSettings(권한 요청)만 부른다. 권한을 허용해도 **켜려던 의도(v=true)는 그대로
  //   버려져서** settings.handsFreeGesture는 false로 남고 토글은 OFF 그대로다("권한 필요" 배지만
  //   사라진다 — 실기기 확인). 사용자는 한 번 더 탭해야 한다는 걸 알 방법이 없다.
  //   ⚠️ 접근성 경로는 시스템 설정 화면으로 나갔다 오므로 요청 직후에 다시 물어봐야 소용이 없다
  //     (그 시점엔 아직 안 켠 상태다). 그래서 "켜달라고 했다"는 의도를 ref에 적어두고, 권한이
  //     실제로 채워지는 순간(복귀 후 재확인) 그때 이어서 켠다.
  // 손짓을 **켤 때** 개인 보정 시트를 띄운다. 이미 보정한 사람에게는 다시 묻지 않는다.
  // (사람마다 손짓 깊이가 달라 상수 하나로는 맞출 수 없다 — GestureCalibrationSheet 주석 참고)
  const [calibVisible, setCalibVisible] = useState(false);
  const pendingEnableRef = useRef<null | 'gesture' | 'bluetooth'>(null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const check = async () => {
      const [acc, cam] = await Promise.all([
        autoNextService.hasPermission().catch(() => false),
        bluetoothService.hasCameraPermission().catch(() => false),
      ]);
      setHasAccessibility(acc);
      setHasCameraPerm(cam);
      const pending = pendingEnableRef.current;
      if (pending === 'gesture' && acc && cam) { pendingEnableRef.current = null; setGesture(true); }
      else if (pending === 'bluetooth' && acc) { pendingEnableRef.current = null; setVolumeSkip(true); }
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 실제 스와이프(dispatchGesture)는 결국 접근성 서비스를 거쳐야 하므로(PaceAccessibilityService.
  // swipeOnce), 손짓/블루투스 둘 다 접근성이 꺼져 있으면 무력화된다 — 손짓은 카메라 권한도 추가로 필요.
  const gestureBlocked = !isIOS && (!hasAccessibility || !hasCameraPerm);
  const bluetoothBlocked = !isIOS && !hasAccessibility;

  // 2026-08-01 사장님 실기기 지적("손짓 켜져 있는데 안 됨") — setHandsFreeGestureEnabled()가
  // onValueChange(토글을 직접 만졌을 때)에서만 네이티브로 밀어졌다. handsFreeGesture가 예전
  // 기본값(true)으로 이미 저장돼 있던 기존 사용자는 이 토글을 한 번도 직접 안 건드려서 네이티브
  // SharedPreferences에 handsfree_gesture_enabled 키 자체가 없었고, 오늘 그 fallback이
  // true→false로 바뀌면서(e088091) UI는 계속 ON인데 실제 감지기는 꺼진 채로 남는 불일치가
  // 생겼다 — 화면 진입 시(그리고 값이 바뀔 때마다) 현재 JS 값을 네이티브로 무조건 다시 밀어준다
  // (setHandsFreeGestureEnabled는 멱등이라 반복 호출해도 안전).
  useFocusEffect(
    useCallback(() => {
      if (isIOS || gestureBlocked) return;
      bluetoothService.setHandsFreeGestureEnabled(settings.handsFreeGesture).catch(() => {});
    }, [isIOS, gestureBlocked, settings.handsFreeGesture])
  );

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
    // 🔴 2026-08-15 — 🤖는 Linking.openURL을 쓰면 App Link 라우팅을 타서 유튜브가 죽어 있을 때
    //   **6초 넘게 검은 화면**이 된다(QA_FULL_TEST US25 실측). Linking에는 패키지를 지정할 방법이
    //   없어서, 네이티브에 setPackage를 붙여 여는 함수를 뒀다. 실패하면(유튜브 미설치/비활성)
    //   기존 경로로 폴백한다 — 느리더라도 열리는 게 낫다. iOS는 해당 없음(라우팅 단계 자체가 없다).
    if (Platform.OS === 'android') {
      try {
        const { PaceOverlay } = require('../../../modules/pace-overlay');
        if (PaceOverlay?.openUrlInYouTube?.(item.url)) return;
      } catch {
        // 네이티브 미링크 — 아래 폴백
      }
    }
    Linking.openURL(item.url).catch(() => {});
  }, []);
  const explainAndOpenSettings = async (reason: 'camera' | 'accessibility') => {
    if (reason === 'accessibility') {
      // 🔴 2026-08-20 Play 정책 반려(2차) — 여기가 **고지를 건너뛰고 권한을 요청하던 경로**다.
      //   정책은 "권한을 요청하기 직전에, 앱 안에서" 고지 대화상자를 띄우고 사용자가 명시적으로
      //   동의를 표현하게 할 것을 요구한다. 토스트 한 줄은 고지가 아니고 동의를 받지도 않는다.
      //   → 다른 진입점과 동일하게 AccessibilityOnboardingSheet를 거치게 한다.
      //   ⚠️ 접근성 설정을 여는 경로는 **전부** 이 시트를 거쳐야 한다. 1차 반려 때 시트 하나만
      //     보고 "앱 쪽은 갖춰져 있다"고 판단해 우회 경로를 안 찾은 것이 2차 반려로 이어졌다.
      setShowAccessibilityDisclosure(true);
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
    const camOk = await bluetoothService.hasCameraPermission().catch(() => false);
    setHasCameraPerm(camOk);
    // 권한 다이얼로그는 별도 액티비티라 위 AppState 'active' 재확인이 보통 먼저 처리하지만,
    // 기기에 따라 그 이벤트가 안 올 수 있어 여기서도 한 번 이어서 켠다(ref라 중복 실행은 없다).
    const accOk = await autoNextService.hasPermission().catch(() => false);
    setHasAccessibility(accOk);
    if (pendingEnableRef.current === 'gesture' && accOk && camOk) {
      pendingEnableRef.current = null;
      setGesture(true);
    } else if (pendingEnableRef.current === 'gesture' && !camOk) {
      // 🔴 2026-08-14 — 여기서 안 비우면 "켜달라"는 의도가 ref에 남는다. 나중에 사용자가 **다른
      //   이유로** 카메라 권한을 주는 순간(예: 다른 기능에서 허용) 위 AppState 재확인이 그걸 소비해
      //   **누른 적도 없는 손짓이 저절로 켜진다.** 방금 병렬 세션이 고친 "손짓이 동의 없이 켜지던 것"
      //   (59fb492, 실측 WAVE 오탐으로 영상이 저절로 넘어감)과 같은 종류의 사고다.
      //   카메라는 이 자리에서 사용자가 방금 답을 준 경우(거부)이므로 의도를 여기서 확실히 버린다.
      //   ⚠️ 접근성은 시스템 설정으로 나갔다 오는 경로라 이 시점에 "거부"를 알 수 없다 — 그래서
      //     위 accessibility 분기에서는 절대 비우지 않는다(복귀 후 재확인이 소비한다).
      pendingEnableRef.current = null;
    }
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
          {/* 접근성이 꺼져 있으면 "추적 중"이라고 하면 안 된다 — 위 trackingLive 주석 참고.
              🔴 2026-08-22 Play 정책 — 예전엔 여기서 설명 없이 바로 설정으로 튕겼다. 홈 배너와
              동일하게 고지·동의 시트를 먼저 띄운다(정책: 권한 요청 **직전** 인앱 고지 필수). */}
          <Pressable
            style={[styles.liveTag, !trackingLive && styles.liveTagWarning]}
            disabled={trackingLive}
            onPress={() => setShowAccessibilityDisclosure(true)}
          >
            <View style={[styles.liveDot, !trackingLive && styles.liveDotWarning]} />
            <Text style={[styles.liveTagText, !trackingLive && styles.liveTagTextWarning]}>
              {trackingLive ? t('focus.liveEngine') : t('focus.permissionNeeded')}
            </Text>
          </Pressable>
          <Text style={styles.heroLabel}>{t('focus.focusSession')}</Text>
          {/* 🔴 2026-08-13 — 여기가 "YouTube" 하드코딩이었다. 틱톡 세션 중에도 YouTube라고 떠서
              사용자가 보는 화면과 앱이 말하는 게 달랐다(발견 12와 같은 계열 — 앱 구분이 UI에서
              무너지는 지점). 실제 세션의 플랫폼을 쓴다. 세션이 없으면 마지막 선택을 보여준다. */}
          <Text style={styles.heroTitle}>{activePlatform === 'tiktok' ? 'TikTok' : 'YouTube'}</Text>

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
          {/* 🔴 2026-09-04 — 핸즈프리 행들과 같은 결함(스위치 히트영역 41dp, 행에 탭 타겟 없음).
              전수 확인 중 발견해 같이 고친다. */}
          <Pressable
            style={styles.interventionRow}
            onPress={() => onBreakToggle(!(settings.breakIntervalMinutes > 0))}
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.breakIntervalMinutes > 0 }}
            accessibilityLabel={t('focus.breakReminder')}
          >
            <View>
              <Text style={styles.interventionTitle}>{t('focus.breakReminder')}</Text>
              <Text style={styles.interventionSub}>{t('focus.everyNMinutes', { n: settings.breakIntervalMinutes || DEFAULT_SETTINGS.breakIntervalMinutes })}</Text>
            </View>
            <Switch
              value={settings.breakIntervalMinutes > 0}
              onValueChange={onBreakToggle}
              pointerEvents="none"
              trackColor={{ true: colors.primary, false: '#262626' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#262626"
            />
          </Pressable>
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
          {/* 🔴 2026-09-04 사장님 지적("토글이 왜 누르면 아무 반응을 안 해? 끌어야만 하잖아") —
              실기기 uiautomator로 확정했다. 스위치의 실제 히트영역이 [850,1730][972,1801],
              즉 **122×71px ≈ 41×24dp**뿐이고 행에는 탭 타겟이 아예 없었다. Material 최소
              터치 타겟(48dp)의 절반이라 손가락으로 그 안을 매번 맞출 수 없다. 실측:
                · 스위치 정중앙 탭 → 토글됨
                · 30px 왼쪽 / 50px 아래 / 행 텍스트 탭 → **전부 무반응**
              "끌면 된다"도 이걸로 설명된다 — 드래그는 손가락이 이동하다 결국 스위치 안으로
              들어가서 먹는 것이다. adb 합성 탭은 항상 정중앙을 찍으니 코드만 봐선 정상으로 보였다.
              → 행 전체를 탭 타겟으로 만든다. 스위치는 pointerEvents="none"으로 두어 같은 탭이
                두 번 발화하지 않게 하고, 실제 처리는 행의 onPress 하나로 모은다. */}
          <GlassSurface style={styles.card}>
            <Pressable
              style={styles.interventionRow}
              onPress={() => setMaster(!masterOn)}
              accessibilityRole="switch"
              accessibilityState={{ checked: masterOn }}
              accessibilityLabel={t('focus.handsFreeMode')}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.interventionTitle}>{t('focus.handsFreeMode')}</Text>
                <Text style={styles.interventionSub}>{handsFreeMethods}</Text>
              </View>
              <Switch
                value={masterOn}
                onValueChange={setMaster}
                pointerEvents="none"
                trackColor={{ true: colors.primary, false: '#262626' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#262626"
              />
            </Pressable>
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
              <AnimatedPressable
                entering={FadeInDown.duration(180)}
                exiting={FadeOutUp.duration(160)}
                layout={LinearTransition.duration(180)}
                style={styles.handsFreeSubCard}
                onPress={() => onBluetoothToggle(!(volumeSkipOn && !bluetoothBlocked))}
                accessibilityRole="switch"
                accessibilityState={{ checked: volumeSkipOn && !bluetoothBlocked }}
              >
                <View style={[styles.handsFreeIcon, bluetoothBlocked && styles.handsFreeRowBlocked]}><RemoteClickIllustration /></View>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {/* 🔴 2026-08-13 사장님 지시("블루투스 리모컨 옆에 홈 카드의 반짝이는 녹색 아이콘을
                      달아서 실제 연결돼 있는지 표시") — 지금까지 이 줄은 "기능을 켰는지"만 보여줬고
                      **리모컨이 실제로 붙어 있는지**는 알 수 없었다. 홈 플랫폼 카드의 활성 표시와
                      똑같은 점(연결=초록 펄스 / 미연결=회색 정적)을 쓴다 — 같은 의미에 같은 기호. */}
                  {/* ⚠️ 2026-08-13(2차) 사장님 지적("블루투스 왼쪽에 있으니 손짓과 글자 배열이 안 맞잖아,
                      오른쪽으로 바꾸든지") — 라벨 **앞**에 두니 이 줄만 글자 시작 위치가 점+간격만큼
                      밀려 아래 손짓 행과 어긋났다. 라벨 **뒤**로 옮겨 두 행의 글자가 같은 x에서 시작한다. */}
                  {/* 🔴 2026-08-15 — iOS는 이 점의 실제 신호원(리모컨 키 입력)이 /feed 화면 안에서만
                      발생한다(PaceVolumeKey가 거기서만 켜짐) — Focus 탭에선 리모컨을 눌러도 이 점이
                      절대 안 켜진다(구조적 한계, 사장님 승인된 트레이드오프). 실시간 확인은 피드
                      화면 상단 배지(feed/index.tsx)에서. Android는 InputDevice 정적 판정이라 여기서도 정확. */}
                  <Text style={[styles.interventionTitle, bluetoothBlocked && styles.handsFreeRowBlocked]}>{t('handsFreeSheet.bluetoothRemoteLabel')}</Text>
                  <ConnectedDot connected={isBluetoothConnected} />
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
                  onValueChange={onBluetoothToggle}
                  pointerEvents="none"
                  trackColor={{ true: colors.primary, false: '#262626' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#262626"
                />
              </AnimatedPressable>
            )}
            {masterOn && (
              <AnimatedPressable
                entering={FadeInDown.duration(180).delay(40)}
                exiting={FadeOutUp.duration(160)}
                layout={LinearTransition.duration(180)}
                style={styles.handsFreeSubCard}
                onPress={() => onGestureToggle(!(gestureOn && !gestureBlocked))}
                accessibilityRole="switch"
                accessibilityState={{ checked: gestureOn && !gestureBlocked }}
              >
                <View style={[styles.handsFreeIcon, gestureBlocked && styles.handsFreeRowBlocked]}><GestureFlickIllustration /></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.interventionTitle, gestureBlocked && styles.handsFreeRowBlocked]}>{t('handsFreeSheet.handWaveLabel')}</Text>
                    {gestureBlocked ? (
                      <View style={styles.permissionNeededBadge}>
                        <Text style={styles.permissionNeededBadgeText}>{t('focus.permissionNeeded')}</Text>
                      </View>
                    ) : (
                      /* 🔴 2026-09-05 사장님 결정("포커스 온은 자동 넘기기로 하고 불안정한 손짓이
                         된다고 하고 튜닝을 계속 해야 할 듯") — 손짓을 확정 기능처럼 보이게 두면
                         사용자는 "안 되는 앱"으로 기억한다. 실제 상태를 그대로 표시한다.
                         블루투스 행의 "추천" 배지와 짝을 이룬다. */
                      <View style={styles.experimentalBadge}>
                        <Text style={styles.experimentalBadgeText}>{t('handsFreeSheet.experimental')}</Text>
                      </View>
                    )}
                  </View>
                  {camDenied && (
                    <Text onPress={() => setCamDisclosure(true)} style={styles.camDeniedHint}>
                      {t('focus.cameraDeniedHint')}
                    </Text>
                  )}
                </View>
                <Switch
                  value={gestureOn && !gestureBlocked}
                  onValueChange={onGestureToggle}
                  pointerEvents="none"
                  trackColor={{ true: colors.primary, false: '#262626' }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#262626"
                />
              </AnimatedPressable>
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

      {/* Play 정책 고지·동의 시트 — "동의하고 설정 열기"를 눌렀을 때만 설정이 열린다. */}
      <Modal visible={camDisclosure} transparent animationType="fade" onRequestClose={() => setCamDisclosure(false)}>
        <Pressable style={styles.camModalOverlay} onPress={() => setCamDisclosure(false)}>
          <Pressable style={styles.camModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.camModalTitle}>{t('focus.camDisclosureTitle')}</Text>
            <Text style={styles.camModalBody}>{t('focus.camDisclosureBody')}</Text>
            <Pressable style={styles.camModalOpenBtn} onPress={() => { setCamDisclosure(false); Linking.openSettings().catch(() => {}); }}>
              <Text style={styles.camModalOpenText}>{t('focus.camDisclosureOpen')}</Text>
            </Pressable>
            <Pressable style={styles.camModalCancel} onPress={() => setCamDisclosure(false)}>
              <Text style={styles.camModalCancelText}>{t('settings.cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <AccessibilityOnboardingSheet
        visible={showAccessibilityDisclosure}
        onEnable={() => {
          setShowAccessibilityDisclosure(false);
          overlayService.requestAccessibilityPermission?.();
        }}
        onDismiss={() => setShowAccessibilityDisclosure(false)}
      />

      {/* 손짓을 켤 때 뜨는 개인 보정 — 손짓 깊이는 손 크기·거리·조명에 따라 사람마다 다르다.
          상수 하나를 전 사용자에게 쓰던 것이 과발화의 직접 원인이었다(실측: 사람이 앞에 있으면
          1.2초마다 연속 발화, 빈 벽에서는 2분간 0회). 건너뛰면 기본값으로 동작한다. */}
      <GestureCalibrationSheet
        visible={calibVisible}
        onDone={() => setCalibVisible(false)}
        onSkip={() => setCalibVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  camModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  camModalCard: { width: '100%', maxWidth: 340, backgroundColor: colors.card, borderRadius: radius.card, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  camModalTitle: { fontSize: 17, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textPrimary, marginBottom: 8 },
  camModalBody: { fontSize: 13.5, fontFamily: typography.bodyFontFamilyMedium, color: colors.textSecondary, lineHeight: 20, marginBottom: 18 },
  camModalOpenBtn: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  camModalOpenText: { color: '#FFFFFF', fontSize: 14.5, fontFamily: typography.bodyFontFamilyExtrabold },
  camModalCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  camModalCancelText: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.bodyFontFamilyBold },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: spacing.lg }, // 2026-09-02 24→16: 상용 표준(Apple HIG/Material 16pt)·home과 통일(박스가 좁아 보이던 불일치 해소)

  heroCard: { borderRadius: 30, padding: 24, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  liveTag: { position: 'absolute', top: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.primary}33`, borderWidth: 1, borderColor: `${colors.primary}4D`, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveTagText: { fontSize: 8, fontFamily: typography.bodyFontFamilyExtrabold, color: '#A5B4FC', letterSpacing: 0.5, textTransform: 'uppercase' },
  // 접근성이 꺼져 추적이 반쪽일 때 — 알약의 "권한 필요" 배지와 같은 앰버로 맞춘다(같은 원인, 같은 색).
  liveTagWarning: { backgroundColor: '#F5A52433', borderColor: '#F5A5244D' },
  liveDotWarning: { backgroundColor: '#F5A524' },
  liveTagTextWarning: { color: '#F5A524' },
  experimentalBadge: { backgroundColor: `${colors.textTertiary}22`, borderWidth: 1, borderColor: `${colors.textTertiary}44`, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  experimentalBadgeText: { fontSize: 9, fontFamily: typography.bodyFontFamilyExtrabold, color: colors.textTertiary, letterSpacing: 0.4, textTransform: 'uppercase' },
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
