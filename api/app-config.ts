// Vercel Serverless Function — 앱 최소 지원 버전(강제 업데이트) 공급자.
//
// ── 왜 필요한가 (2026-08-08 사장님 지시) ──
// "새 버전 내면 앱 시작할 때 업데이트 노티와 함께 스토어로 보내서, 업데이트해야 앱이 쓰이게 하면 안 돼?"
//
// 우리는 이미 OTA(expo-updates)를 쓰고 있어서 **JS만 바뀐 수정은 스토어 없이 즉시 배포**된다.
// 그런데 OTA로 못 고치는 것이 있다:
//   ① 네이티브 코드 변경(Kotlin/Swift) — 예: 2026-08-06의 틱 정확도, PIP 오표시, 광고 내비바
//   ② 새 네이티브 모듈/권한/SDK 변경
// 이건 스토어 바이너리를 새로 깔아야만 반영된다. 게다가 우리 runtimeVersion 정책은 `appVersion`이라
// **OTA는 같은 앱 버전의 바이너리에만 도달한다** — 1.0.0 사용자는 1.0.1용 OTA를 영영 못 받는다.
// 즉 낡은 바이너리에 머무는 사용자를 끌어올릴 수단이 지금 전혀 없다. 그 구멍을 이 엔드포인트가 막는다.
//
// ── 설계 원칙 ──
// 1) **판정 기준은 서버에만 둔다.** 앱에 하드코딩하면 그걸 고치려고 또 스토어 심사를 타야 한다
//    (shorts-entry.ts와 같은 이유·같은 패턴).
// 2) **반드시 fail-open.** 서버가 죽거나 응답이 이상하면 앱은 **절대 막지 않는다**. 강제 업데이트는
//    잘못 켜지면 전 사용자를 앱에서 쫓아내는 유일한 기능이라, 실패 시 기본값은 항상 "통과"여야 한다.
// 3) **킬 스위치**(`enabled`)를 둔다. 사고가 나면 이 값 하나만 false로 바꿔 배포하면 즉시 해제된다.
//
// ⚠️⚠️ minSupportedVersion 운영 규칙 — 어기면 사고가 난다
//   - **이미 스토어에 올라가 승인된 버전**보다 높게 두지 말 것. 높게 두면 그 버전을 받을 방법이 없어
//     모든 사용자가 영구히 차단된다(업데이트 버튼을 눌러도 스토어에 그 버전이 없다).
//   - **심사 중에는 올리지 말 것.** 애플/구글 심사자가 심사 중인 빌드로 앱을 열었을 때 차단 화면이
//     뜨면 "앱이 동작하지 않음"으로 리젝된다. 새 버전이 **승인·출시된 뒤에** 올린다.
//   - 올리는 순서: 새 버전 출시 완료 → 하루 이틀 지켜본 뒤 → minSupportedVersion 상향.

type VercelRequest = { query: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

// ⚠️ 이 값이 강제 업데이트의 유일한 스위치다. 위 운영 규칙을 반드시 읽고 바꿀 것.
//
// ⚠️⚠️ 판정 기준은 **버전 문자열이 아니라 빌드 번호**다(Android versionCode / iOS CFBundleVersion).
//   2026-08-08에 버전 문자열로 만들었다가 실기기에서 함정을 밟았다: app.json이 플랫폼별
//   runtimeVersion을 고정하고 있어(android="1.0", ios="1.0.1") 안드로이드는 릴리스가 올라가도
//   계속 "1.0"을 보고했다 — 버전 문자열로는 안드로이드를 아예 구분할 수 없었다.
//   빌드 번호는 스토어 제출 때 반드시 올라가는 단조 증가 정수라 그런 모호함이 없다.
//   (자세한 경위는 src/services/appVersionGate.ts의 nativeBuildNumber 주석에 있다.)
const CONFIG = {
  // false면 앱은 버전과 무관하게 절대 차단하지 않는다(사고 시 즉시 해제용 킬 스위치).
  enabled: true,
  // 이 빌드 번호 **미만**이면 차단한다.
  //   Android = versionCode (android/app/build.gradle의 그 값이 진짜다 — app.json이 아니다)
  //   iOS     = CFBundleVersion (project.pbxproj의 CURRENT_PROJECT_VERSION)
  // 현재 출시본이 android=6 / ios=5이므로 그보다 낮게 둔다
  // (= 지금은 아무도 차단되지 않는다. 배선만 살아 있고 실제 차단은 0명).
  // 다음 네이티브 릴리스가 스토어에 **승인·출시된 뒤에** 그 빌드 번호로 올린다.
  minBuildNumber: {
    ios: 1,
    android: 1,
  },
  // 표시·로그용(앱은 판정에 쓰지 않는다).
  latestVersion: '1.0.1',
  storeUrl: {
    ios: 'https://apps.apple.com/app/id0000000000',
    android: 'https://play.google.com/store/apps/details?id=com.strides7.pace',
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.platform;
  const platform = (Array.isArray(raw) ? raw[0] : raw) === 'ios' ? 'ios' : 'android';

  // 캐시는 짧게 — 사고 시 킬 스위치가 빨리 퍼져야 한다(shorts-entry의 10분보다 훨씬 짧게 잡는다).
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  res.status(200).json({
    enabled: CONFIG.enabled,
    platform,
    minBuildNumber: CONFIG.minBuildNumber[platform],
    latestVersion: CONFIG.latestVersion,
    storeUrl: CONFIG.storeUrl[platform],
  });
}
