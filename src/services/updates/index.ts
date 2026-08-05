// 2026-07-22 감사수정(iOS 회귀): 이전엔 `import * as Updates from 'expo-updates'`(런타임 import)라,
// 이 네이티브 모듈이 아직 빌드에 없는 바이너리(재빌드 전 기기/시뮬)에서 이 파일을 import하는 순간
// (=_layout.tsx가 checkAndForceUpdate를 import) 'Cannot find native module ExpoUpdates' throw →
// ErrorBoundary undefined로 앱 전체가 크래시했다. 타입만 import(런타임 erased)하고, 실제 모듈은
// 함수 안에서 lazy require + try/catch로 로드해 네이티브가 없으면 조용히 스킵한다.
import { AppState } from 'react-native';
import type * as UpdatesNS from 'expo-updates';
import { useTimerStore } from '../../store/useTimerStore';
import { usePlayerStore } from '../../store/usePlayerStore';

// 2026-07-22 사용자 지시 — OTA(무선 업데이트) + "강제 푸쉬" 도입. app.json에서
// updates.checkAutomatically를 NEVER로 꺼뒀다(기본값 ON_LOAD는 조용히 백그라운드에서 받아 "다음"
// 콜드스타트에만 반영 — 지금 쓰고 있는 세션은 계속 구버전으로 남는다. 이 앱은 스크린타임 집행
// 로직처럼 정확성이 중요한 버그를 빨리 밀어야 할 수 있어서, "받으면 즉시 반영"하는 강제 방식이
// 필요하다는 판단). 이 모듈이 그 수동 제어를 전부 담당 — _layout.tsx가 콜드스타트 + 포그라운드
// 복귀마다 checkAndForceUpdate()를 부른다.
//
// 2026-07-22 밤 — 별도 QA 검사관이 findings로 지적(qa/apps/pace/FINDINGS.md OTA-1): 리로드 직전에
// "지금 사용자가 세션/재생 중인지" 가드가 전혀 없어서, Android 오버레이 세션(useTimerStore)이나
// Pace Feed 재생(usePlayerStore) 도중에 업데이트가 도착하면 강제 리로드가 인메모리 상태를 전부
// 날려버리는 문제가 있었다 — 정확한 지적이라 반영. 다운로드까지는 그대로 하되(오래 걸리는 부분을
// 먼저 끝내두는 게 유리), 활성 세션/재생 중이면 리로드만 미루고 hasPendingDownloadedUpdate로
// 기억해뒀다가 다음 체크(다음 포그라운드 복귀, 즉 세션이 끝나고 앱을 벗어났다 돌아온 시점)에
// 가드가 풀려있으면 재다운로드 없이 바로 반영한다.
//
// 정상/비정상 케이스:
//  - dev 클라이언트/Expo Go에서는 Updates.isEnabled가 false거나 checkForUpdateAsync 자체가
//    ERR_NOT_AVAILABLE_IN_DEV_CLIENT로 reject한다 — 개발 중엔 아예 스킵(정상 케이스, 에러 아님).
//  - 네트워크가 없거나 서버가 응답 안 하면 checkForUpdateAsync가 reject — 조용히 실패로 처리하고
//    현재 버전으로 계속 쓰게 둔다(업데이트를 "강제"한다고 해서 네트워크 없을 때 앱을 막으면 안 됨).
//  - 업데이트가 있는데 다운로드 도중 실패(fetchUpdateAsync reject) — 마찬가지로 조용히 실패,
//    다음 체크 때(다음 포그라운드 복귀) 재시도. 부분 다운로드가 다음 실행을 깨뜨리지 않음
//    (expo-updates 자체가 원자적 다운로드/스왑을 보장).
//  - 활성 세션/재생 중이면 리로드를 미룸(위 OTA-1 대응) — 다운로드는 이미 끝났으니 다음 체크에서
//    바로 반영.
//  - 너무 잦은 체크로 서버에 부담 주지 않도록 MIN_CHECK_INTERVAL_MS 안에는 재체크 안 함(단,
//    다운로드가 이미 끝나 리로드만 기다리는 중이면 이 스로틀과 무관하게 매 포그라운드 복귀마다
//    가드를 재확인한다 — 아래 hasPendingDownloadedUpdate 분기 참고).
//
// 2026-08-06 사장님 지시("웹서치해서 OTA 예외처리 다 해서 적용해") — expo-updates v57 문서를 다시
// 대조해 빠진 것들을 채웠다. 아래 5가지가 이번에 추가/수정된 부분이다.
//
//  ① 🔴 **롤백(isRollBackToEmbedded) 처리가 아예 없었다.** 우리가 잘못된 OTA를 쏜 뒤 `eas update:roll-back`
//     을 발행하면, 서버는 "새 업데이트 있음"이 아니라 **"내장 번들로 되돌려라"** 라는 별개 지시를 준다.
//     그때 checkForUpdateAsync()는 `{ isAvailable: false, isRollBackToEmbedded: true }`로 온다.
//     기존 코드는 isAvailable만 보고 'no-update'로 끝내서 **롤백이 사용자에게 영영 도달하지 않았다.**
//     OTA의 유일한 되돌리기 수단이 작동하지 않고 있던 셈 — 나쁜 번들을 밀면 스토어 심사를 다시 타야만
//     복구되는 상태였다. (v57 문서의 UpdateCheckResult/UpdateFetchResult에 이 필드가 명시돼 있다.)
//  ② reloadAsync() **뒤에 아무 로직도 두지 않는다** — 문서 명시 주의사항: 이 프라미스는 실제 리로드보다
//     먼저 resolve되므로 그 뒤 코드는 실행이 보장되지 않는다. 그래서 checkInFlight를 여기서 풀지 않는다
//     (어차피 곧 프로세스가 새로 뜬다. 푸는 순간 리로드 직전에 또 체크가 들어올 수 있다).
//  ③ **포그라운드일 때만 리로드한다.** 백그라운드에서 리로드하면 사용자가 다음에 앱을 열었을 때 이유 없이
//     첫 화면으로 튕겨 있다(무슨 일이 있었는지 알 방법이 없어 "앱이 꺼졌다"로 읽힌다).
//  ④ **연속 실패에 백오프.** 기존엔 실패해도 1분 고정이라 네트워크가 죽어 있으면 포그라운드마다 계속
//     헛수고를 했다. 실패가 쌓이면 간격을 늘린다(AdBanner 로드 실패 백오프와 같은 원리).
//  ⑤ **진단 정보 노출**(getUpdateDiagnostics). "OTA가 왜 안 와?"를 조사할 때 채널/런타임버전/현재 업데이트
//     ID가 없으면 아무것도 못 한다 — 오늘 광고 조사에서 로그가 없어 원인을 못 좁혔던 것과 같은 교훈.
const MIN_CHECK_INTERVAL_MS = 60_000; // 1분 — 포그라운드 복귀할 때마다 매번 네트워크 왕복하지 않게.
// 연속 실패 시 상한. 1분 → 2 → 4 → 8분에서 멈춘다(그 이상 벌리면 정작 복구된 뒤 반영이 너무 늦다).
const MAX_CHECK_INTERVAL_MS = 8 * 60_000;
let lastCheckAtMs = 0;
let consecutiveFailures = 0;
let checkInFlight = false;
let hasPendingDownloadedUpdate = false;
// 롤백 지시를 받아 내장 번들로 되돌리는 중인지 — 리로드가 미뤄질 때도 이 성격을 기억해야 한다
// (다음 기회에 리로드하면 되는 건 같지만, 로그/결과값에서 일반 업데이트와 구분돼야 조사가 된다).
let pendingIsRollback = false;

export type ForceUpdateResult =
  | { status: 'skipped-dev' }
  | { status: 'skipped-throttled' }
  | { status: 'skipped-background' }
  | { status: 'no-update' }
  | { status: 'check-failed'; error: unknown }
  | { status: 'download-failed'; error: unknown }
  | { status: 'deferred-mid-session'; rollback: boolean }
  | { status: 'reload-failed'; error: unknown; rollback: boolean }
  | { status: 'reloading'; rollback: boolean };

export type ForceUpdatePhase = 'checking' | 'downloading' | 'reloading';

/** Android 오버레이 세션(useTimerStore) 또는 Pace Feed 재생(usePlayerStore) 도중인지. */
function isUserMidSession(): boolean {
  return useTimerStore.getState().isSessionActive || usePlayerStore.getState().isPlaying;
}

/**
 * 리로드해도 되는 순간인가 — 앱이 실제로 화면에 있어야 한다(위 ③).
 * 'inactive'(iOS 전환 중/권한 팝업)도 제외한다: 그 순간 리로드하면 팝업 뒤에서 앱이 재시작된다.
 */
function isAppForeground(): boolean {
  return AppState.currentState === 'active';
}

/** dev 클라이언트/Updates 비활성에서 나는 정상 에러 — 실패로 세지 않고 조용히 스킵한다. */
function isUpdatesUnavailableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'ERR_UPDATES_DISABLED' || code === 'ERR_NOT_AVAILABLE_IN_DEV_CLIENT';
}

/**
 * 현재 실행 중인 번들의 신원 — "OTA가 왜 안 와?"를 조사할 때 첫 번째로 봐야 하는 값들(위 ⑤).
 * 네이티브 모듈이 없거나 dev면 전부 null이 담긴 객체를 돌려준다(호출부가 분기하지 않아도 되게).
 */
export function getUpdateDiagnostics(): {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean | null;
  channel: string | null;
  runtimeVersion: string | null;
  updateId: string | null;
} {
  try {
    const Updates = require('expo-updates') as typeof UpdatesNS;
    return {
      isEnabled: Updates.isEnabled,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      channel: Updates.channel ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: Updates.updateId ?? null,
    };
  } catch {
    return { isEnabled: false, isEmbeddedLaunch: null, channel: null, runtimeVersion: null, updateId: null };
  }
}

/**
 * 2026-08-06 추가 — expo-updates가 **네이티브 쪽에 직접 남긴** 최근 로그. 위 getUpdateDiagnostics가
 * "지금 무슨 번들인가"라면 이건 "왜 그 번들인가"에 답한다(서명 실패/런타임버전 불일치/다운로드
 * 오류 등은 JS로 올라오지 않고 여기에만 남는다).
 * 실패하면 빈 배열 — 이 함수 때문에 앱이 죽거나 부팅이 늦어지면 안 된다.
 */
export async function getUpdateNativeLog(maxAgeMs = 60 * 60 * 1000): Promise<string[]> {
  try {
    const Updates = require('expo-updates') as typeof UpdatesNS;
    if (!Updates.isEnabled || typeof Updates.readLogEntriesAsync !== 'function') return [];
    const entries = await Updates.readLogEntriesAsync(maxAgeMs);
    return entries.map((e) => `${e.level} ${e.code ?? ''} ${e.message}`.trim());
  } catch {
    return [];
  }
}

/**
 * 업데이트 확인 → 있으면 다운로드 → 세션 중이 아니면 즉시 재시작(강제 반영), 세션 중이면 다운로드된
 * 상태로 대기. 실패해도 절대 throw하지 않는다 — 호출부(_layout.tsx)가 매 포그라운드 복귀마다
 * fire-and-forget으로 부르기 때문에, 여기서 던지면 unhandled rejection이 쌓인다. 결과는 로그/원격
 * 관측용으로만 반환. onPhaseChange — "다운로드 중"/"적용 중" 같은 블로킹 UI를 그리기 위한 진행
 * 상태 콜백(선택).
 */
export async function checkAndForceUpdate(onPhaseChange?: (phase: ForceUpdatePhase) => void): Promise<ForceUpdateResult> {
  if (__DEV__) {
    return { status: 'skipped-dev' };
  }
  // lazy load — 네이티브 모듈 미링크(재빌드 전) 빌드에서 크래시 대신 조용히 스킵.
  let Updates: typeof UpdatesNS;
  try {
    Updates = require('expo-updates');
  } catch {
    return { status: 'skipped-dev' };
  }
  if (!Updates.isEnabled) {
    return { status: 'skipped-dev' };
  }
  if (checkInFlight) {
    return { status: 'skipped-throttled' };
  }
  // 이미 다운로드가 끝나서 리로드만 기다리는 중이면, 매번 새로 체크/다운로드할 필요 없이 세션
  // 가드만 재확인해서 풀렸으면 바로 반영 — 이 경로는 MIN_CHECK_INTERVAL_MS 스로틀 대상이 아니다
  // (네트워크 호출이 없으므로 서버 부담과 무관).
  if (hasPendingDownloadedUpdate) {
    if (isUserMidSession()) {
      return { status: 'deferred-mid-session', rollback: pendingIsRollback };
    }
    if (!isAppForeground()) {
      return { status: 'skipped-background' };
    }
    checkInFlight = true;
    onPhaseChange?.('reloading');
    // 🔴 2026-08-06 — 여기 예외처리가 없어서 **OTA가 영구히 죽는 경로**가 있었다.
    //   이 분기는 위의 try/finally 밖이라, reloadAsync()가 네이티브 예외를 던지면 checkInFlight가
    //   true로 남는다 → 이후 모든 checkAndForceUpdate()가 맨 위에서 'skipped-throttled'로 즉시
    //   반환된다 → **이미 받아둔 업데이트조차 이 프로세스에선 영영 적용되지 않는다.**
    //   (같은 예외를 아래 본 경로에서는 finally가 풀어주고 있었다 — 이쪽만 빠져 있었다.)
    //   ⚠️ 성공 시에는 여전히 아무것도 하지 않는다(위 ②: reloadAsync는 실제 리로드보다 먼저
    //     resolve되므로 뒤 코드의 실행이 보장되지 않는다). catch에서만 되돌린다.
    try {
      await Updates.reloadAsync();
    } catch (error) {
      checkInFlight = false;
      // 다운로드분은 그대로 유지한다 — 다음 포그라운드 복귀에서 재시도하면 되고, 실패했다고
      // 지우면 멀쩡히 받아둔 번들을 버리고 처음부터 다시 받게 된다.
      consecutiveFailures += 1;
      return { status: 'reload-failed', error, rollback: pendingIsRollback };
    }
    return { status: 'reloading', rollback: pendingIsRollback };
  }
  const now = Date.now();
  // 연속 실패가 쌓이면 간격을 벌린다(위 ④) — 1 → 2 → 4 → 8분 상한.
  const interval = Math.min(MIN_CHECK_INTERVAL_MS * Math.pow(2, consecutiveFailures), MAX_CHECK_INTERVAL_MS);
  if (now - lastCheckAtMs < interval) {
    return { status: 'skipped-throttled' };
  }
  checkInFlight = true;
  lastCheckAtMs = now;
  try {
    onPhaseChange?.('checking');
    let check: UpdatesNS.UpdateCheckResult;
    try {
      check = await Updates.checkForUpdateAsync();
    } catch (error) {
      // dev 클라이언트/비활성은 실패가 아니다 — 백오프를 키우지 않는다.
      if (isUpdatesUnavailableError(error)) return { status: 'skipped-dev' };
      consecutiveFailures += 1;
      return { status: 'check-failed', error };
    }
    consecutiveFailures = 0;
    // 🔴 롤백 지시(위 ①) — isAvailable은 false지만 "내장 번들로 되돌려라"라는 별개 지시다.
    // 이걸 안 보면 우리가 나쁜 번들을 밀었을 때 되돌릴 방법이 없다.
    const isRollback = check.isRollBackToEmbedded === true;
    if (!check.isAvailable && !isRollback) {
      return { status: 'no-update' };
    }
    onPhaseChange?.('downloading');
    // 롤백도 동일하게 fetchUpdateAsync()로 "적용 대상"을 확정한 뒤 리로드해야 한다(v57 문서).
    let fetched: UpdatesNS.UpdateFetchResult;
    try {
      fetched = await Updates.fetchUpdateAsync();
    } catch (error) {
      consecutiveFailures += 1;
      return { status: 'download-failed', error };
    }
    const rollback = fetched.isRollBackToEmbedded === true;
    // isNew=false면 지금 돌고 있는 것과 같은 번들이다 — 리로드할 이유가 없다(공연히 세션만 날린다).
    if (!rollback && !fetched.isNew) {
      return { status: 'no-update' };
    }
    if (isUserMidSession()) {
      hasPendingDownloadedUpdate = true;
      pendingIsRollback = rollback;
      return { status: 'deferred-mid-session', rollback };
    }
    if (!isAppForeground()) {
      hasPendingDownloadedUpdate = true;
      pendingIsRollback = rollback;
      return { status: 'skipped-background' };
    }
    onPhaseChange?.('reloading');
    // ⚠️ 이 줄 뒤에 로직을 추가하지 말 것(위 ②) — reloadAsync는 실제 리로드보다 먼저 resolve된다.
    // 2026-08-06 — 예전엔 여기서 던져 호출부가 잡게 했는데, 그러면 "왜 리로드가 안 됐는지"가
    //   호출부의 빈 catch로 사라졌다(_layout.tsx는 unhandled rejection만 막고 조용히 삼킨다).
    //   위 pending 경로와 동일하게 결과값으로 돌려 로그에 남게 한다. 다운로드분은 이미 적용
    //   대기 상태이므로 다음 콜드스타트에 expo-updates가 알아서 반영한다.
    try {
      await Updates.reloadAsync();
    } catch (error) {
      hasPendingDownloadedUpdate = true; // 다음 포그라운드 복귀에서 리로드만 재시도
      pendingIsRollback = rollback;
      consecutiveFailures += 1;
      return { status: 'reload-failed', error, rollback };
    }
    return { status: 'reloading', rollback };
  } finally {
    // 리로드 경로에선 이 줄에 도달하지 못할 수 있다(위 주석) — 그 외 모든 경로에서만 풀린다.
    checkInFlight = false;
  }
}
