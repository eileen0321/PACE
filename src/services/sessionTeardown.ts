import { Platform } from 'react-native';
import { useTimerStore } from '../store/useTimerStore';
import { useAutoNextStore } from '../store/useAutoNextStore';
import { useSessionStore } from '../store/useSessionStore';
import { overlayService } from './platform';
import { endSession as endSessionRow, logOverlayEvent } from '../database/repositories/sessionsRepository';
import { pushUnsyncedSessions } from './sync/backendSync';
import type { SessionEndStatus } from '../types/models';

// 2026-08-13 — `/overlay`의 언마운트 cleanup에만 있던 세션 종료 로직을 여기로 뽑았다.
//
// ── 왜 뽑아야 했나 (발견 12: 앱을 갈아타면 시청시간이 첫 앱으로 기록되던 것) ──
// 안드로이드에서 세션 행의 수명은 `/overlay` 컴포넌트보다 **길다.** 그 화면은 마운트되자마자
// keepSessionAliveOnUnmountRef=true를 세우고 스스로 Home으로 router.replace하기 때문에
// (overlay/index.tsx의 useFocusEffect), 세션은 살아 있는데 **그 세션을 닫는 코드는 이미
// 언마운트된 화면 안에** 있다. 그래서 Home에서 "유튜브 세션을 닫고 틱톡 세션을 연다"를 하려면
// 이 40여 줄을 복제할 수밖에 없었고, 복제하는 순간 이 프로젝트가 반복해서 겪은 사고
// ("같은 계산이 두 곳에 갈라져 한쪽만 고쳐진다")가 그대로 재현된다.
// → 계산을 한 곳에 두고 두 호출부가 같이 쓴다.
//
// ⚠️ **읽는 순서가 계약의 일부다.** 아래 세 값은 반드시 `overlayService.endSession()`(네이티브
//   ACTION_STOP) **전에** 읽어야 한다 — 세션이 닫히면 네이티브 카운터가 리셋된다.
//     ① useTimerStore.watchedSeconds (동기, 첫 await 앞에서)
//     ② overlayService.getWatchedSeconds()
//     ③ overlayService.getVideoWatchCount()
//   ①이 특히 미묘하다: timer.endSession()이 이 함수의 await 사이에 끼어들어 스토어를
//   리셋하므로, 동기 시점에 읽어두지 않으면 0이 된다.

export type SessionTeardownParams = {
  sessionId: string;
  userId: string;
  /** 세션 시작 시각(ms). 벽시계 상한 계산에 쓴다. null이면 상한 0. */
  startedAtMs: number | null;
  /**
   * 이미 확정된 종료 사유. null이면 🤖에서 네이티브에 한 번 더 물어보고(consumeExpired),
   * 그래도 없으면 'unknown'으로 남긴다 — "사용자가 직접 껐다(manual_stop)"와 "끝내 사유를
   * 알아내지 못했다"를 통계에서 섞지 않기 위해서다(2026-08-02).
   */
  endReason: SessionEndStatus | null;
  /** sleep_detected일 때 "실제 마지막으로 움직인 시각". 없으면 now로 기록. */
  sleepOnsetAtMs?: number | null;
};

/**
 * 세션을 끝내고 DB/네이티브/스토어를 전부 정리한다. **절대 throw하지 않는다** —
 * 호출부가 언마운트 cleanup이거나 탭 핸들러라 던지면 갈 곳이 없다.
 *
 * DB 기록은 백그라운드로 돌리지 않고 **await한다**. 호출부가 "닫힌 뒤에 새 세션을 연다"를
 * 해야 하는 경우(앱 전환)가 있어서, 여기서 기다려주지 않으면 두 세션이 겹친다.
 */
export async function teardownSession(params: SessionTeardownParams): Promise<void> {
  const { sessionId, userId, startedAtMs } = params;
  let endReason = params.endReason;
  let sleepOnsetAtMs = params.sleepOnsetAtMs ?? null;

  try {
    // 사유를 모른 채 여기 왔으면 네이티브에 마지막으로 한 번 더 물어본다 — Activity가
    // sleep-detect 직후 Recents 스와이프로 destroy될 때처럼, 실제로는 sleep_detected인데
    // 아무 판정도 못 받고 도달하는 경우를 잡는다.
    if (endReason == null && Platform.OS === 'android') {
      const result = await overlayService.consumeExpired().catch(() => null);
      if (result) {
        endReason = result.reason;
        sleepOnsetAtMs = result.sleepOnsetAtMs;
      }
    }
    const reason: SessionEndStatus = endReason ?? 'unknown';
    const effectiveEndedAtMs =
      reason === 'sleep_detected' && sleepOnsetAtMs != null ? sleepOnsetAtMs : Date.now();

    const wallClockSeconds = startedAtMs
      ? Math.max(0, Math.round((effectiveEndedAtMs - startedAtMs) / 1000))
      : 0;
    // ⚠️ 위 주석 ① — 첫 await 앞에서 동기로 읽는다.
    const jsWatchedSeconds = useTimerStore.getState().watchedSeconds;
    const watchedSeconds = await overlayService.getWatchedSeconds().catch(() => null);
    const effectiveWatchedSeconds = watchedSeconds != null ? watchedSeconds : jsWatchedSeconds;
    // 벽시계를 상한으로 둔다 — 네이티브 누적값이 실제 경과 시간을 넘는 건 정의상 불가능하므로,
    // 넘으면(복구 경로 중복 가산 등) 신뢰하지 않고 자른다.
    const durationSeconds = Math.min(wallClockSeconds, Math.max(0, effectiveWatchedSeconds));
    const videosWatched = await overlayService.getVideoWatchCount().catch(() => 0);

    // 🔴 2026-08-13 발견 1 — 3초 미만 세션은 기록하지 않는다. 🍎 피드(feed/index.tsx:268)에는
    //   원래 있던 가드인데 🤖 경로에만 없어서, 카드 오탭·즉시 뒤로가기가 0초 행으로 쌓였다.
    //   D33이 약속한 동작을 양쪽에서 성립시킨다. 행을 남기지 않을 뿐 네이티브/스토어 정리는
    //   그대로 해야 하므로 return하지 않고 아래 finally로 흘려보낸다.
    if (durationSeconds >= 3) {
      await endSessionRow(
        sessionId,
        durationSeconds,
        videosWatched,
        reason,
        new Date(effectiveEndedAtMs).toISOString()
      );
      await pushUnsyncedSessions(userId);
      logOverlayEvent(userId, sessionId, 'SESSION_STOP', reason).catch(() => {});
    } else {
      // 열린 행을 그대로 두면 고아 세션으로 남아 다음 콜드스타트의 정리 대상이 된다 —
      // 짧아서 "기록 안 함"인 것이지 "안 닫음"이 아니다. 0초로 닫고 사유를 남긴다.
      await endSessionRow(sessionId, 0, 0, 'discarded_too_short', new Date(effectiveEndedAtMs).toISOString());
    }
  } catch {
    // DB/네이티브 어느 단계에서 실패해도 아래 정리는 반드시 돈다.
  } finally {
    useTimerStore.getState().endSession();
    useAutoNextStore.getState().stop();
    overlayService.endSession().catch(() => {});
    useSessionStore.getState().finish();
  }
}
