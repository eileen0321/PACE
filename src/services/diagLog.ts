import { AppState, InteractionManager } from 'react-native';
import { File, Paths } from 'expo-file-system';

// 🔴 2026-08-25 사장님 헬스장 재발 검증용 — "손짓이 씹혔다 vs 실행이 밀렸다"를 사후에 숫자로
// 판정할 수 있도록, Release에서도 남는 초경량 이벤트 로그. 손짓 진단 NSLog는 8/2 지시로 Release에서
// 컴파일 아웃돼 있어(제출용 노이즈 제거) 재발 시 물증이 전혀 안 남았다 — 이 파일이 그 구멍을 메운다.
// 이벤트 4종만, 한 줄씩 append: gesture_next(손짓→넘김 실행) / gesture_drop_cooldown(발화됐지만
// JS 쿨다운에 걸림) / adv_drop_burst(WebView 실행시점 게이트가 밀린 묶음을 버림) / deadman_reload.
// 개인정보 없음(타임스탬프+이벤트명뿐). 256KB 넘으면 반토막(오래된 앞부분 버림).
// 꺼내기: xcrun devicectl device copy from ... --domain-type appDataContainer
//        --domain-identifier com.strides7.pace --source Documents/pace_diag.log
// ⚠️ expo-file-system v57: 기본 export가 신 API(Paths/File, 동기 read/write)다. 구 documentDirectory
//   API는 'expo-file-system/legacy'로 밀려났다 — AGENTS.md의 "Expo HAS CHANGED" 그 건이다.
//
// ── 🔴 2026-08-29 재작성: 호출 즉시 쓰던 것을 버퍼링으로 바꾼다 ──
// 이 API 는 **영상 전환 경로 한복판**에서 불린다(useFeedRemoteControl 의 gesture_next 는
// onNext() 직전, feed/index.tsx 의 go_next·video_changed, 플레이어의 swipe_state). 전환 한 번에
// 동기 파일 쓰기가 3회씩 일어났고, 위 File API 는 **전부 동기**라 그동안 JS 스레드가 멈춘다.
// 더 나쁜 건 256KB 를 넘는 순간이다 — 256KB 를 통째로 동기로 읽어(textSync) 절반을 잘라 다시
// 쓴다. 그 정지가 로그가 그만큼 쌓일 때마다 반복된다.
// 전환 순간의 "씹힘"을 잡으려고 만든 로그가 그 씹힘의 원인이 될 수 있는 구조였다.
//
// 고친 방식: 호출은 **메모리 배열에 push 만** 하고(사실상 공짜), 실제 파일 쓰기는
//   ① 애니메이션·터치가 끝난 뒤(InteractionManager) ② 그마저 안 오면 2초 뒤 타이머
//   ③ 앱이 백그라운드로 갈 때(유실 방지)
// 중 먼저 오는 시점에 **모아서 한 번에** 한다. 반토막도 그때만 한다.
const MAX_BYTES = 256 * 1024;
/** 버퍼 상한 — 넘으면 오래된 줄부터 버린다. 진단 로그가 메모리를 먹으면 안 된다. */
const MAX_BUFFER_LINES = 2000;
const FLUSH_DELAY_MS = 2000;

let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushScheduled = false;

/** 실제 파일 쓰기 — 반드시 핫패스 밖에서만 불린다. */
function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushScheduled = false;
  if (buffer.length === 0) return;
  const chunk = buffer.join('');
  buffer = [];
  try {
    const f = new File(Paths.document, 'pace_diag.log');
    if (!f.exists) {
      f.create(); // append 모드는 파일이 있어야 한다 — 최초 1회 생성
    } else if ((f.size ?? 0) > MAX_BYTES) {
      // 반토막도 여기서만 한다 — 예전엔 이 동기 읽기/쓰기가 전환 경로에서 터졌다.
      const base = f.textSync();
      f.write(base.slice(Math.floor(base.length / 2)) + chunk);
      return;
    }
    f.write(chunk, { append: true });
  } catch {
    // 진단이 앱을 방해하면 안 된다 — 조용히 포기(버린 줄은 되살리지 않는다).
  }
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  // 애니메이션·제스처가 끝난 뒤로 미룬다. 그게 안 오는 화면도 있으므로 타이머로 바닥을 깐다.
  InteractionManager.runAfterInteractions(flushNow);
  flushTimer = setTimeout(flushNow, FLUSH_DELAY_MS);
}

// 앱이 내려갈 때 남은 줄을 반드시 내보낸다 — 안 그러면 정작 필요한 마지막 순간이 유실된다.
AppState.addEventListener('change', (s) => {
  if (s !== 'active') flushNow();
});

export function diagLog(event: string, detail?: string) {
  // 여기서는 절대 파일을 건드리지 않는다(위 재작성 주석 참고). push 만 한다.
  buffer.push(`${new Date().toISOString()} ${event}${detail ? ' ' + detail : ''}\n`);
  if (buffer.length > MAX_BUFFER_LINES) buffer.splice(0, buffer.length - MAX_BUFFER_LINES);
  scheduleFlush();
}

/** 종료·테스트 경로에서 강제로 내보내야 할 때. */
export function flushDiagLog() {
  flushNow();
}
