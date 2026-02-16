/**
 * Indica si una estrategia está en período gratuito vigente (hoy).
 * is_free === true && (free_until === null || free_until >= hoy).
 */
export function isStrategyFreeAndActive(strategy: { is_free?: boolean; free_until?: Date | string | null }): boolean {
  if (!strategy?.is_free) return false;
  const until = strategy.free_until;
  if (until == null) return true;
  const untilDate = typeof until === 'string' ? new Date(until) : until;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  untilDate.setHours(0, 0, 0, 0);
  return untilDate >= today;
}
