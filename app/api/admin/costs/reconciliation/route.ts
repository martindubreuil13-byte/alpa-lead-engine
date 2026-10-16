import { requireAdmin } from '@/lib/auth/require-admin'
import { isSameSiteJson, json, timeZoneOf } from '@/lib/costs/admin-request'
import { parseReconciliationInput } from '@/lib/costs/reconcile'
import { createServerClient } from '@/lib/supabase/server'
import { loadReconciliation, saveReconciliation, todayIn } from '@/lib/costs/reconcile-store'

export const dynamic = 'force-dynamic'

const monthStart = (value: string | null, today: string) => {
  const text = value && /^\d{4}-\d{2}(-01)?$/.test(value) ? value.slice(0, 7) : null
  // The month being reconciled defaults to the month that just ended.
  const [year, month] = today.split('-').map(Number)
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  return `${text ?? previous}-01`
}

export async function GET(request: Request) {
  const { error: denied } = await requireAdmin(await createServerClient())
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const tz = timeZoneOf(params.get('tz'))
  try {
    return json(await loadReconciliation(monthStart(params.get('month'), todayIn(tz)), tz))
  } catch {
    return json({ state: 'error', message: 'The reconciliation could not be loaded.' }, 500)
  }
}

export async function PUT(request: Request) {
  const { userId: adminId, error: denied } = await requireAdmin(await createServerClient())
  if (denied) return denied
  if (!isSameSiteJson(request)) return json({ error: 'Send JSON from the dashboard.' }, 415)
  const body = await request.json().catch(() => null)
  const tz = timeZoneOf(body?.tz)
  const parsed = parseReconciliationInput(body, todayIn(tz))
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  try {
    return json(await saveReconciliation(parsed.value, adminId, tz))
  } catch {
    return json({ state: 'error', message: 'The reconciliation could not be saved.' }, 500)
  }
}
