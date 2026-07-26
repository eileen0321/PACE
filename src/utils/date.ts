// 2026-07-26 버그 발견 — 통계 화면들이 "오늘"을 new Date().toISOString().slice(0,10)로 구했는데,
// 이건 UTC 기준 날짜다. DB 쪽(statsRepository.ts)은 SQLite date(started_at, 'localtime')로 기기
// 로컬 시간대 기준 날짜를 쓴다. 한국(UTC+9)처럼 UTC보다 앞선 시간대에서는 자정~오전 9시 사이에
// UTC 날짜가 아직 전날이라 "오늘" 문자열이 실제 로컬 날짜보다 하루 늦게 계산된다 — 그 결과 방금
// 기록된 오늘 세션이 weeklyStats에서 "오늘"로 안 잡혀 주간 평균/스트릭/베스트데이가 0으로 보이는
// 버그가 있었다. 로컬 연/월/일을 직접 조합해 SQLite의 localtime 기준과 맞춘다.
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
