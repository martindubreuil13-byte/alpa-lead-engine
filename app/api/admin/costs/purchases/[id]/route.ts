import { requireAdmin } from '@/lib/auth/require-admin'
import { isSameSiteJson, json, timeZoneOf } from '@/lib/costs/admin-request'
import { parsePurchaseEditInput } from '@/lib/costs/reconcile'
import { editPrepaidPurchase, loadReconciliation, todayIn } from '@/lib/costs/reconcile-store'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Corrects a prepaid purchase. The previous values are kept in an audit trail with who changed them and when; a repeated submission is
 * applied once; a form built on an older version is refused. Nothing about recorded API consumption can change here.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { userId: adminId, error: denied } = await requireAdmin(supabase)
  if (denied) return denied
  if (!isSameSiteJson(request)) return json({ error: 'Send JSON from the dashboard.' }, 415)

  const id = Number((await context.params).id)
  if (!Number.isInteger(id) || id < 1) return json({ error: 'Unknown purchase.' }, 404)
  const body = await request.json().catch(() => null)
  const tz = timeZoneOf(body?.tz)
  const parsed = parsePurchaseEditInput(body, todayIn(tz))
  if (!parsed.ok) return json({ error: parsed.error }, 400)

  try {
    const { data } = await supabase.auth.getUser()
    const outcome = await editPrepaidPurchase(id, parsed.value, { id: adminId, label: data?.user?.email ?? null })
    if (outcome.status === 'not_enabled') return json({ state: 'not_enabled' }, 409)
    if (outcome.status === 'not_found') return json({ error: 'Unknown purchase.' }, 404)
    if (outcome.status === 'stale') return json({ status: 'stale', error: 'This purchase was changed since you opened it. Reload and try again.' }, 409)
    if (outcome.status === 'error') return json({ error: 'The purchase could not be saved.' }, 500)
    const month = parsed.value.purchasedOn.slice(0, 7)
    return json({ status: outcome.status, version: outcome.version, ...(await loadReconciliation(`${month}-01`, tz)) })
  } catch {
    return json({ error: 'The purchase could not be saved.' }, 500)
  }
}

/** A purchase is never deleted: mistakes are corrected, and the original stays in the history. */
export async function DELETE() {
  return json({ error: 'Prepaid purchases cannot be deleted. Edit the purchase to correct it.' }, 405)
}
