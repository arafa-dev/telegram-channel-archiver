export function clampConcurrency(value: string | number | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value || '3', 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(6, parsed));
}
