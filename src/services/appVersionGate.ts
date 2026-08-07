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
import type * as UpdatesNS from 'expo-updates';
import { API_BASE_URL } from './api/client';

const FETCH_TIMEOUT_MS = 4000; // 부팅 경로라 길게 못 기다린다 — 넘으면 그냥 통과시킨다.

export type VersionGateResult =
  | { blocked: false; reason: 'ok' | 'disabled' | 'no-version' | 'fetch-failed' | 'bad-payload' }
  | { blocked: true; storeUrl: string; currentVersion: string; minSupportedVersion: string };

/**
 * 지금 돌고 있는 **네이티브 바이너리**의 앱 버전.
 *
 * ⚠️ `Constants.expoConfig.version`을 쓰면 안 된다 — OTA가 적용된 뒤에는 그 값이 **업데이트 번들의
 *   버전**이 되어, 정작 알고 싶은 "설치된 바이너리 버전"과 달라진다.
 *   `Updates.runtimeVersion`은 바이너리에 컴파일돼 들어가고 OTA로 바뀌지 않는다(그게 런타임 버전의
 *   존재 이유다 — 호환되는 업데이트만 걸러내는 기준). 우리 정책이 `{"policy":"appVersion"}`이라
 *   이 값이 곧 빌드 시점의 app.json version("1.0.1")이다.
 * 네이티브 모듈이 없거나(미링크) dev 클라이언트면 null → 호출부가 통과시킨다.
 */
function nativeAppVersion(): string | null {
  try {
    const Updates = require('expo-updates') as typeof UpdatesNS;
    const v = Updates.runtimeVersion;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * "1.0.10" vs "1.0.9"를 문자열 비교하면 틀린다(사전순으로 "1.0.10" < "1.0.9"). 숫자 단위로 비교한다.
 * 형식이 이상하면(숫자가 아닌 조각) null — 호출부는 그 경우 **통과**시킨다.
 */
function compareVersions(a: string, b: string): number | null {
  const parse = (s: string) => s.trim().split('.').map((x) => Number.parseInt(x, 10));
  const pa = parse(a);
  const pb = parse(b);
  if (pa.length === 0 || pb.length === 0) return null;
  if (pa.some((n) => !Number.isFinite(n)) || pb.some((n) => !Number.isFinite(n))) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 서버에 최소 지원 버전을 물어보고 차단 여부를 판정한다. **절대 throw하지 않는다.**
 * 호출부는 blocked=true일 때만 차단 화면을 띄우면 된다.
 */
export async function checkVersionGate(): Promise<VersionGateResult> {
  const currentVersion = nativeAppVersion();
  // 버전을 못 읽으면(dev 클라이언트/미링크) 판정 자체가 불가능 — 통과.
  if (!currentVersion) return { blocked: false, reason: 'no-version' };

  let payload: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${API_BASE_URL}/api/app-config?platform=${Platform.OS}`, {
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
    minSupportedVersion?: unknown;
    storeUrl?: unknown;
  } | null;

  // 킬 스위치 — 사고 시 서버에서 이것만 false로 바꾸면 즉시 해제된다.
  if (!cfg || cfg.enabled !== true) return { blocked: false, reason: 'disabled' };

  const min = typeof cfg.minSupportedVersion === 'string' ? cfg.minSupportedVersion : null;
  const storeUrl = typeof cfg.storeUrl === 'string' ? cfg.storeUrl : null;
  // 스토어 주소가 없으면 막아봐야 사용자가 빠져나갈 길이 없다 — 그런 차단은 하지 않는다.
  if (!min || !storeUrl) return { blocked: false, reason: 'bad-payload' };

  const cmp = compareVersions(currentVersion, min);
  if (cmp === null) return { blocked: false, reason: 'bad-payload' };
  if (cmp >= 0) return { blocked: false, reason: 'ok' };

  return { blocked: true, storeUrl, currentVersion, minSupportedVersion: min };
}
