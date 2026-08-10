import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { STORAGE_KEYS } from '../storage/keys';

// 🔴 2026-08-10 사장님 지적("앱 지웠다 설치하면 계속 포커스 10분에 광고 보고 15분을 쓸 수 있는 거
//   아냐?" → "기기를 기억하면 되잖아" / "익명 id 구분 못 해?") — 익명 id 자체는 원래 있었다.
//   이 값이 /auth/guest로 가서 서버에 게스트 계정을 만든다(AuthController). 문제는 **저장 위치**였다:
//   Math.random()으로 만들어 AsyncStorage에만 뒀기 때문에 앱을 지우면 같이 지워졌고, 재설치하면
//   새 id → **새 게스트 계정**이 생겨 서버가 완전히 다른 사람으로 봤다. 그래서 서버에 무슨 기록을
//   남기든 재설치 한 번이면 초기화됐다(광고 없이 10분 + 광고 5분을 무한 반복할 수 있던 경로).
//
// → 앱 저장소가 아니라 **OS가 들고 있는 값**에서 뽑는다.
//   Android: Settings.Secure.ANDROID_ID(expo-application의 getAndroidId). 앱 삭제·재설치에도 유지되고
//     공장초기화에서만 바뀐다. 구글도 남용 방지(anti-abuse) 용도의 SSAID 사용을 권장한다
//     — ⚠️ 광고 ID(AAID)와 결합하면 정책 위반이므로 이 값은 광고 요청에 절대 쓰지 않는다.
//   iOS: 아직 예전 방식이다. IDFV(getIosIdForVendorAsync)는 **같은 개발사 앱을 전부 지우면 초기화**돼서
//     이 목적에 못 쓴다. iOS에서 삭제를 견디는 곳은 Keychain뿐이라 expo-secure-store가 필요한데
//     지금 package.json에 없다(네이티브 의존성 추가 + 재빌드가 필요해 임의로 넣지 않았다).
//     그때까지 iOS는 재설치 시 여전히 새 id가 된다 — 알고 남겨둔 구멍이다.
//
// ⚠️ 기존 사용자 보호: 이미 저장된 id가 있으면 **그걸 그대로 쓴다.** 안 그러면 업데이트 순간 모두
//   새 게스트 계정으로 갈아타 기존 기록(설정/통계/구독 연결)이 끊긴다. 새 설치에만 새 규칙이 적용된다.

function generateDeviceId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `dev-${rand()}-${rand()}`;
}

/** 앱 삭제를 견디는 OS 수준 식별자. 못 얻으면 null(호출부가 임의 생성으로 폴백). */
function stableOsDeviceId(): string | null {
  if (Platform.OS !== 'android') return null;
  try {
    const androidId = Application.getAndroidId();
    // 일부 커스텀 롬/에뮬레이터가 빈 문자열이나 상수를 돌려주는 경우가 있어 형태를 최소 검증한다.
    if (androidId && androidId.length >= 8) return `android-${androidId}`;
  } catch {
    // 값이 없으면 그냥 폴백 — 식별자를 못 얻는다고 로그인/앱 시작이 막히면 안 된다.
  }
  return null;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  if (existing) return existing;
  const id = stableOsDeviceId() ?? generateDeviceId();
  await AsyncStorage.setItem(STORAGE_KEYS.deviceId, id);
  return id;
}
