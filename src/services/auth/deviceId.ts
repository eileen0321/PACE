import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
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
//   iOS: IDFV(getIosIdForVendorAsync)는 같은 개발사 앱을 전부 지우면 초기화돼서 이 목적에 못 쓴다.
//     2026-08-10 웹서치(Apple Dev Forums "Preventing reuse of free periods" 등) 확인 —
//     iOS에서 앱 삭제를 실제로 견디는 저장소는 Keychain뿐이다(전체 기기 초기화/암호화 안 된 백업
//     복원에만 같이 날아감). DeviceCheck(서버투서버, 비트 2개)가 더 변조 내성이 강하지만 이미
//     서버에 focus_allowance 테이블이 있으니 "그 서버 기록을 재설치 후에도 같은 게스트로 찾아가게"
//     하는 게 목적이라 Keychain으로 충분 — expo-secure-store 추가, 새 native 의존성이라 재빌드 필요.
//
// ⚠️ 기존 사용자 보호: 이미 저장된 id가 있으면 **그걸 그대로 쓴다.** 안 그러면 업데이트 순간 모두
//   새 게스트 계정으로 갈아타 기존 기록(설정/통계/구독 연결)이 끊긴다. 새 설치에만 새 규칙이 적용된다.
//   iOS 마이그레이션: 이 버전 이전 설치는 Keychain이 비어 있고 AsyncStorage에만 값이 있다 —
//   그 값을 그대로 쓰고 Keychain에도 백필해서, **다음** 재설치부터 같은 id를 되찾게 한다(이번
//   업데이트 자체로는 아무도 id가 안 바뀐다 — 재설치해야만 효과가 생긴다는 뜻이기도 하다).

function generateDeviceId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `dev-${rand()}-${rand()}`;
}

/** 앱 삭제를 견디는 OS 수준 식별자(안드로이드 전용, iOS는 아래 Keychain 경로가 따로 처리). */
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
  if (Platform.OS === 'ios') {
    try {
      const fromKeychain = await SecureStore.getItemAsync(STORAGE_KEYS.deviceId);
      if (fromKeychain) return fromKeychain;
    } catch {
      // Keychain 접근 실패(드묾) — 아래 AsyncStorage/신규생성 경로로 폴백
    }
  }
  const existing = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  if (existing) {
    if (Platform.OS === 'ios') await SecureStore.setItemAsync(STORAGE_KEYS.deviceId, existing).catch(() => {});
    return existing;
  }
  const id = stableOsDeviceId() ?? generateDeviceId();
  await AsyncStorage.setItem(STORAGE_KEYS.deviceId, id);
  if (Platform.OS === 'ios') await SecureStore.setItemAsync(STORAGE_KEYS.deviceId, id).catch(() => {});
  return id;
}
