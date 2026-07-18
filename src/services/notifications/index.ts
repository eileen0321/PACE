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

async function fireLocal(title: string, body: string) {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
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
