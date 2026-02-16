/**
 * Indica si un usuario está dentro del período de prueba gratuita (usuarios nuevos).
 * Requiere settings.free_trial_enabled y que (hoy - user.created_at) <= free_trial_days.
 */
export function userHasActiveFreeTrial(
  user: { created_at?: Date | string | null },
  settings: { free_trial_enabled?: boolean; free_trial_days?: number }
): boolean {
  if (!settings?.free_trial_enabled || !user?.created_at) return false;
  const days = Math.max(1, Math.floor(Number(settings.free_trial_days) || 0));
  const created = typeof user.created_at === 'string' ? new Date(user.created_at) : user.created_at;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  created.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDays <= days;
}
