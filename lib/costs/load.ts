import { createAdminClient } from '@/lib/supabase/admin'
import type { RawTrackingHealth } from '@/lib/costs/health'
import { buildCostReport, type CostReport, type DateRange, type LimitRow, type RawHistory, type RawOverview } from '@/lib/costs/report'

export type CostReportResult =
  | { state: 'ready'; report: CostReport }
  // The cost tables have not been created yet (the migration is not applied): say so instead of showing zeros that look real.
  | { state: 'not_enabled' }
  | { state: 'error'; message: string }

const isMissingObject = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find the function|schema cache/i.test(error.message ?? '')))

/** One aggregated database answer per question; raw request rows never leave the database. */
export async function loadCostReport(range: DateRange, tz: string): Promise<CostReportResult> {
  const admin = createAdminClient() as any
  const args = { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_tz: tz }
  const overview = await admin.rpc('admin_cost_overview', args)
  if (overview.error) return isMissingObject(overview.error) ? { state: 'not_enabled' } : { state: 'error', message: 'The cost figures could not be loaded.' }

  const [history, limits, health] = await Promise.all([
    admin.rpc('admin_research_history', args),
    admin.from('api_cost_limits').select('scope, provider, limit_usd, alert_at_percent, enforce'),
    admin.rpc('admin_tracking_health'),
  ])
  return {
    state: 'ready',
    report: buildCostReport(
      overview.data as RawOverview,
      history.error ? null : (history.data as RawHistory),
      limits.error ? [] : ((limits.data ?? []) as LimitRow[]),
      range,
      health.error ? null : (health.data as RawTrackingHealth)
    ),
  }
}
