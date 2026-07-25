# PACE — Mac 세션 인수인계 (2026-07-26)

> Windows 세션에서 최근 커밋(`feat(feed): 집중모드 인디케이터`, `fix(feed): 토스트 setState 분리` 등)
> + 그 시점 uncommitted 상태(다른 Android 세션 작업분 포함)를 코드리뷰한 결과. 빌드를 깨는 문제는
> 없었고(TS 컴파일 클린), 아래 1개만 실기기에서 재확인 필요.

---

## 1. `src/app/feed/index.tsx` — safe-area inset 폴백 비대칭 (재확인 필요)

**증상 가능성**: `fullScreenModal` 프레젠테이션에서 `useSafeAreaInsets().top`이 0으로 나오는 기기/
상황이 있으면(이 파일 자체 주석이 그 가능성을 명시함), 비디오가 상태바 아래로 다시 파고드는
문제가 재발할 수 있음 — 이건 커밋 `b0f1236`("Feed: push WebView + UI below system status bar")이
이미 한 번 고친 버그와 같은 증상.

**원인**: 두 요소가 `insets.top` 처리 방식이 서로 다름.
- 비디오 컨테이너: `paddingTop: insets.top` — **폴백 없음**, 0이면 그대로 0.
- 바로 위 `topBar`: `marginTop: Math.max(insets.top, 47)` — **47pt 폴백 있음**.

`insets.top`이 정상값(예: Dynamic Island 기기 ~59, 일반 노치 ~47)이면 문제 없지만, 0으로 나오는
케이스에서는 topBar만 47pt로 안전하게 내려가고 비디오는 진짜 0까지 붙어버려서, 상단바와 비디오
시작선이 서로 어긋나는 상태가 됨.

**제안 수정**: 비디오 컨테이너도 topBar와 동일하게 `Math.max(insets.top, 47)`(또는 공통 상수로
추출)을 쓰도록 통일. 시뮬레이터에서는 이 케이스가 안 나왔을 수 있어서 지금까지 못 잡혔을 가능성 —
Dynamic Island 없는 기기(예: iPhone SE, 구형 기종)나 회전/멀티태스킹 상황에서 실기기 확인 요망.

---

## 참고 — 같은 리뷰에서 발견했지만 Android 전용이라 Mac 쪽 조치 불필요
- `PaceOverlayService.kt`: zap 배지 기능을 넣었다 되돌리면서 죽은 필드/주석이 남음(무해, 클린업만
  필요) — Android 세션에 별도 전달 예정.
- `PaceHandWaveDetector.kt`: hand-growth 트리거 경로가 `fireTrigger()`를 재사용 안 하고 로직
  중복 — 지금 임계값에선 무해, 나중에 튜닝 시 리스크.
