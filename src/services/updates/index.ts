import * as Updates from 'expo-updates';
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
const MIN_CHECK_INTERVAL_MS = 60_000; // 1분 — 포그라운드 복귀할 때마다 매번 네트워크 왕복하지 않게.
let lastCheckAtMs = 0;
let checkInFlight = false;
let hasPendingDownloadedUpdate = false;

export type ForceUpdateResult =
  | { status: 'skipped-dev' }
  | { status: 'skipped-throttled' }
  | { status: 'no-update' }
  | { status: 'check-failed'; error: unknown }
  | { status: 'download-failed'; error: unknown }
  | { status: 'deferred-mid-session' }
  | { status: 'reloading' };

export type ForceUpdatePhase = 'checking' | 'downloading' | 'reloading';

/** Android 오버레이 세션(useTimerStore) 또는 Pace Feed 재생(usePlayerStore) 도중인지. */
function isUserMidSession(): boolean {
  return useTimerStore.getState().isSessionActive || usePlayerStore.getState().isPlaying;
}

/**
 * 업데이트 확인 → 있으면 다운로드 → 세션 중이 아니면 즉시 재시작(강제 반영), 세션 중이면 다운로드된
 * 상태로 대기. 실패해도 절대 throw하지 않는다 — 호출부(_layout.tsx)가 매 포그라운드 복귀마다
 * fire-and-forget으로 부르기 때문에, 여기서 던지면 unhandled rejection이 쌓인다. 결과는 로그/원격
 * 관측용으로만 반환. onPhaseChange — "다운로드 중"/"적용 중" 같은 블로킹 UI를 그리기 위한 진행
 * 상태 콜백(선택).
 */
export async function checkAndForceUpdate(onPhaseChange?: (phase: ForceUpdatePhase) => void): Promise<ForceUpdateResult> {
  if (__DEV__ || !Updates.isEnabled) {
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
      return { status: 'deferred-mid-session' };
    }
    checkInFlight = true;
    try {
      onPhaseChange?.('reloading');
      await Updates.reloadAsync();
      return { status: 'reloading' };
    } finally {
      checkInFlight = false;
    }
  }
  const now = Date.now();
  if (now - lastCheckAtMs < MIN_CHECK_INTERVAL_MS) {
    return { status: 'skipped-throttled' };
  }
  checkInFlight = true;
  lastCheckAtMs = now;
  try {
    onPhaseChange?.('checking');
    let check: Updates.UpdateCheckResult;
    try {
      check = await Updates.checkForUpdateAsync();
    } catch (error) {
      return { status: 'check-failed', error };
    }
    if (!check.isAvailable) {
      return { status: 'no-update' };
    }
    onPhaseChange?.('downloading');
    try {
      await Updates.fetchUpdateAsync();
    } catch (error) {
      return { status: 'download-failed', error };
    }
    if (isUserMidSession()) {
      hasPendingDownloadedUpdate = true;
      return { status: 'deferred-mid-session' };
    }
    onPhaseChange?.('reloading');
    // reloadAsync 자체가 실패하면(네이티브 쪽 예외) 이 함수 밖(호출부)에서 잡도록 던진다 —
    // 여기까지 왔으면 이미 다운로드가 끝난 상태라 재시도보다 상위 에러 리포팅이 맞다.
    await Updates.reloadAsync();
    return { status: 'reloading' };
  } finally {
    checkInFlight = false;
  }
}
