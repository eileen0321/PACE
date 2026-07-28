import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useSettingsStore } from '../../store/useSettingsStore';
import { resolveSystemLocale, translate } from '../i18n';

// 로컬(기기 내) 알림 전용 — 서버 푸시가 아니라 expo-notifications의 scheduleNotificationAsync를
// trigger:null(즉시 발송)로 쓴다. 세션 중 남은시간/한도도달/휴식리마인더는 앱이 백그라운드에
// 있어도(오버레이 화면이 안 보이는 상태) 사용자에게 닿아야 하는 유일한 채널이기 때문.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let channelReady = false;
async function ensureAndroidChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('pace-session', {
    name: 'Pace session alerts',
    importance: Notifications.AndroidImportance.HIGH,
  });
  channelReady = true;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function currentLocale() {
  const language = useSettingsStore.getState().settings.language;
  return language === 'system' ? resolveSystemLocale() : language;
}

async function fireLocal(title: string, body: string, data?: Record<string, string>) {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({ content: { title, body, data }, trigger: null });
}

// 2026-07-28 사장님 지시 — 랜덤 사용 인사이트 노티(usageInsight.ts가 어떤 문구를 보여줄지 결정,
// 이 함수는 실제 발송만 담당). notifyRemaining/notifyLimit/notifyBreak 같은 세션 설정과 무관하게
// 항상 켜져 있다 — 세션 중 알림이 아니라 하루 1회짜리 재미 요소라 별도 토글 없이 단순하게 둔다.
export async function notifyUsageInsight(title: string, body: string): Promise<void> {
  await fireLocal(title, body);
}

export async function notifyLowTime(remainingMinutes: number): Promise<void> {
  if (!useSettingsStore.getState().settings.notifyRemaining) return;
  const locale = currentLocale();
  const key = remainingMinutes === 1 ? 'overlay.lowTimeWarningSingular' : 'overlay.lowTimeWarningPlural';
  const body = translate(locale, key, { n: remainingMinutes });
  await fireLocal(translate(locale, 'focus.remainingTime'), body);
}

export async function notifyLimitReached(): Promise<void> {
  if (!useSettingsStore.getState().settings.notifyLimit) return;
  const locale = currentLocale();
  await fireLocal(translate(locale, 'overlay.notifLimitReachedTitle'), translate(locale, 'overlay.notifLimitReachedBody'));
}

export async function notifyBreakReminder(): Promise<void> {
  if (!useSettingsStore.getState().settings.notifyBreak) return;
  const locale = currentLocale();
  await fireLocal(translate(locale, 'overlay.notifBreakReminderTitle'), translate(locale, 'overlay.notifBreakReminderBody'));
}

// 2026-07-19: 사용자 지시 — 접근성 권한 On/Off 화면 안내(AccessibilityOnboardingSheet)는 앱을 나가면
// 사라지는 일회성 모달이라, 사용자가 설정 화면을 보다가 다른 데로 새면 다시 앱으로 안 돌아올 수
// 있다. 탭하면 바로 설정으로 이어지는 알림을 별도 채널로 남겨 "나중에라도" 진입점이 있게 한다.
// data.action은 _layout.tsx의 알림 탭 리스너가 읽어 autoNextService.requestPermission()을 호출.
export async function notifyAccessibilityNeeded(): Promise<void> {
  const locale = currentLocale();
  await fireLocal(
    translate(locale, 'overlay.notifAccessibilityNeededTitle'),
    translate(locale, 'overlay.notifAccessibilityNeededBody'),
    { action: 'open-accessibility-settings' }
  );
}
