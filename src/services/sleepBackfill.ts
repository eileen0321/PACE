// Android/기타 no-op — 백그라운드 수면 감지 보정은 iOS 전용(모션 보조프로세서 이력). Android는 네이티브
// PaceOverlayService가 수면 종료를 직접 기록하므로 이 보정이 필요 없다.
export async function backfillSleepFromHistory(_userId: string | null | undefined): Promise<void> {
  /* iOS 전용 (sleepBackfill.ios.ts) */
}
