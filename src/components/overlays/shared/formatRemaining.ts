export function formatRemaining(minutes: number): string {
  if (minutes <= 0) return '0m Left';
  return `${minutes}m Left`;
}
