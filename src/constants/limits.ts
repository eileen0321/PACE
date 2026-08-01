// 2026-08-01 — settings.tsx와 quick-control-sheet.tsx가 각자 같은 이름으로 옵션 배열을 중복
// 정의하고 있었고, 그중 DAILY_LIMIT_OPTIONS는 값 자체가 달랐다(settings.tsx에 15가 빠져있어
// quick-control-sheet에서 15로 설정한 뒤 settings.tsx의 cycle()로 넘기면 30으로 튀는 버그였음).
// 여기 하나로 모아 같은 배열을 참조하게 한다 — 값이 다시 갈라지는 걸 원천 차단.
// SLEEP_TIMER_OPTIONS/BREAK_OPTIONS는 두 파일 값(set)은 같지만 순서가 달라(cycle()이 순서에
// 의존) 지금 통합하면 한쪽의 표시 순서가 바뀌는 부작용이 생겨 — 일부러 그대로 둠.
export const DAILY_LIMIT_OPTIONS = [15, 30, 45, 60, 90, 120];
export const FOCUS_SESSION_DURATION_OPTIONS = [5, 10, 20, 30, 60];
