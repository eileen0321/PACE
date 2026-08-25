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

const MAX_BYTES = 256 * 1024;

export function diagLog(event: string, detail?: string) {
  try {
    const f = new File(Paths.document, 'pace_diag.log');
    const line = `${new Date().toISOString()} ${event}${detail ? ' ' + detail : ''}\n`;
    // 상한 초과 시에만 전체를 읽어 반토막 — 평상시엔 append만이라 비용이 거의 없다.
    if (f.exists && (f.size ?? 0) > MAX_BYTES) {
      const base = f.textSync();
      f.write(base.slice(Math.floor(base.length / 2)) + line);
      return;
    }
    f.write(line, { append: true });
  } catch {
    // 진단이 앱을 방해하면 안 된다 — 조용히 포기.
  }
}
