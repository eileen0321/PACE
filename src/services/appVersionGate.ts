// 강제 업데이트 게이트 — "이 바이너리가 너무 낡았으면 스토어로 보내고 앱 사용을 막는다".
//
// 2026-08-08 사장님 지시: "새 버전 내면 앱 시작할 때 업데이트 노티와 함께 스토어로 이동하게 해서
// 강제 업데이트를 해야 앱이 사용되게 하면 안 돼?"
//
// ── 왜 OTA가 있는데도 필요한가 ──
// OTA(services/updates)는 **JS만** 바꾼다. 네이티브(Kotlin/Swift) 수정은 스토어 바이너리를 새로
// 깔아야 반영된다. 게다가 우리 runtimeVersion 정책이 `appVersion`이라 **OTA는 같은 앱 버전의
// 바이너리에만 도달한다** — 1.0.0에 머문 사용자는 1.0.1용 OTA를 영영 못 받는다. 그 사용자를
// 끌어올릴 수단이 지금까지 없었고, 이 게이트가 그 구멍을 막는다.
//
// ── 이 파일이 지키는 원칙 ──
// **어떤 실패에서도 차단하지 않는다(fail-open).** 강제 업데이트는 잘못 켜지면 전 사용자를 앱에서
// 쫓아내는 유일한 기능이다. 네트워크 실패·타임아웃·응답 파싱 실패·버전 문자열 이상·서버 킬스위치
// off — 전부 "통과"로 끝난다. 차단은 **모든 조건이 명확히 성립할 때만** 일어난다.

import { Platform } from 'react-native';
import * as Application from 'expo-application';
// ⚠️ 2026-08-08 실기기 검증 중 발견 — 처음엔 `API_BASE_URL`(services/api/client)을 썼는데 그건
//   **Railway 백엔드**를 가리킨다. 이 파일이 부르는 /api/app-config는 **Vercel 서버리스 함수**라
//   (api/app-config.ts) 주소가 다르다. 그대로 뒀으면 항상 404 → fail-open으로 **영원히 통과**해
//   기능이 있는데 없는 것과 같은 상태가 됐다(같은 Vercel 함수인 shorts-entry가 이 주소를 쓴다).
import { YOUTUBE_PROXY_URL } from './api/youtube';

const FETCH_TIMEOUT_MS = 4000; // 부팅 경로라 길게 못 기다린다 — 넘으면 그냥 통과시킨다.

export type VersionGateResult =
  | { blocked: false; reason: 'ok' | 'disabled' | 'no-version' | 'fetch-failed' | 'bad-payload' }
  | { blocked: true; storeUrl: string; currentBuild: number; minBuild: number; currentVersion: string | null };

/**
 * 판정 기준을 **빌드 번호**(Android versionCode / iOS CFBundleVersion)로 잡는다.
 *
 * ⚠️ 왜 버전 문자열이 아니라 빌드 번호인가 — 2026-08-08에 실제로 밟은 함정 때문이다.
 *   처음엔 `Updates.runtimeVersion`을 앱 버전으로 썼는데, 실기기 로그가 `current=1.0`으로 나왔다.
 *   확인해보니 app.json이 **플랫폼별 runtimeVersion을 명시적으로 고정**하고 있었다:
 *       ios.runtimeVersion = "1.0.1"   android.runtimeVersion = "1.0"
 *   안드로이드를 "1.0"에 고정한 건 의도된 선택이다 — 모든 안드로이드 릴리스가 같은 runtimeVersion을
 *   공유해야 OTA가 구버전 바이너리에도 닿는다. 그래서 안드로이드는 1.0.1이든 1.0.5든 **영원히
 *   "1.0"을 보고**하고, runtimeVersion으로는 버전을 구분할 수 없다(게이트가 무력해진다).
 *   더 위험한 건, 누가 minSupportedVersion.android에 스토어 버전("1.0.2")을 넣으면 최신 빌드
 *   사용자까지 전부 차단된다는 점이다.
 *
 * → `expo-application`의 네이티브 값을 쓴다. 빌드 번호는 **단조 증가하는 정수**라
 *   "1.0.9 vs 1.0.10" 같은 사전순 함정도, 플랫폼별 표기 차이도 없다. 스토어 제출 때 반드시
 *   올라가는 값이라 "이 바이너리가 그 릴리스보다 오래됐는가"를 가장 정확하게 답한다.
 *   (`nativeApplicationVersion`은 표시·로그용으로만 쓴다.)
 *
 * 값을 못 읽으면(미링크/dev) null → 호출부가 **통과**시킨다.
 */
function nativeBuildNumber(): number | null {
  try {
    const raw = Application.nativeBuildVersion; // Android: versionCode, iOS: CFBundleVersion
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function nativeVersionLabel(): string | null {
  try {
    return Application.nativeApplicationVersion ?? null;
  } catch {
    return null;
  }
}

/**
 * 서버에 최소 지원 버전을 물어보고 차단 여부를 판정한다. **절대 throw하지 않는다.**
 * 호출부는 blocked=true일 때만 차단 화면을 띄우면 된다.
 */
export async function checkVersionGate(): Promise<VersionGateResult> {
  const currentBuild = nativeBuildNumber();
  const currentVersion = nativeVersionLabel();
  // 빌드 번호를 못 읽으면(dev 클라이언트/미링크) 판정 자체가 불가능 — 통과.
  if (currentBuild === null) return { blocked: false, reason: 'no-version' };

  // 프록시 주소가 비어 있으면(빌드 환경변수 누락) 물어볼 곳이 없다 — 통과.
  if (!YOUTUBE_PROXY_URL) return { blocked: false, reason: 'fetch-failed' };

  let payload: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${YOUTUBE_PROXY_URL}/api/app-config?platform=${Platform.OS}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { blocked: false, reason: 'fetch-failed' };
    payload = await res.json();
  } catch {
    // 네트워크 없음/타임아웃/서버 다운 — 사용자를 막을 이유가 전혀 없다.
    return { blocked: false, reason: 'fetch-failed' };
  }

  const cfg = payload as {
    enabled?: unknown;
    minBuildNumber?: unknown;
    storeUrl?: unknown;
  } | null;

  // 킬 스위치 — 사고 시 서버에서 이것만 false로 바꾸면 즉시 해제된다.
  if (!cfg || cfg.enabled !== true) return { blocked: false, reason: 'disabled' };

  // 정수만 받는다. 문자열/실수/음수/NaN은 전부 "판정 불가"로 보고 통과시킨다 —
  // 서버 값이 오염됐을 때 사용자를 막는 쪽으로 기울면 안 된다.
  const minBuild =
    typeof cfg.minBuildNumber === 'number' && Number.isInteger(cfg.minBuildNumber) && cfg.minBuildNumber >= 0
      ? cfg.minBuildNumber
      : null;
  const storeUrl = typeof cfg.storeUrl === 'string' && cfg.storeUrl.length > 0 ? cfg.storeUrl : null;
  // 스토어 주소가 없으면 막아봐야 사용자가 빠져나갈 길이 없다 — 그런 차단은 하지 않는다.
  if (minBuild === null || !storeUrl) return { blocked: false, reason: 'bad-payload' };

  if (currentBuild >= minBuild) return { blocked: false, reason: 'ok' };

  return { blocked: true, storeUrl, currentBuild, minBuild, currentVersion };
}
