// 취침 감지 가드는 iOS 전용(useSleepGuard.ios.ts — 2단계 상태기계, 안드 evaluateSleepStages 패리티).
// Android는 네이티브(PaceOverlayService의 evaluateSleepStages + performTick)가 담당 → 여기선 no-op.
// Metro가 플랫폼별 선택. 반환 형태는 .ios.ts와 동일하게 맞춘다 — feed/index.tsx가 플랫폼 무관하게
// markActivity()를 호출하므로(no-op 버전에서도 undefined 아닌 함수여야 destructure가 안 깨진다).
export function useSleepGuard(_: { enabled: boolean; onSleep: (sleepOnsetAtMs?: number) => void; stillnessMinutes?: number }) {
  return { markActivity: () => {}, isSleepPrompted: false };
}
