import { requireAdmin } from '@/lib/auth/require-admin'
import { isSameSiteJson, json, timeZoneOf } from '@/lib/costs/admin-request'
import { parsePurchaseInput } from '@/lib/costs/reconcile'
import { createServerClient } from '@/lib/supabase/server'
import { addPrepaidPurchase, todayIn } from '@/lib/costs/reconcile-store'

export const dynamic = 'force-dynamic'

/** Records a prepaid credit purchase. It is not usage: nothing here changes any month's estimated or billed cost. */
export async function POST(request: Request) {
  const { userId: adminId, error: denied } = await requireAdmin(await createServerClient())
  if (denied) return denied
  if (!isSameSiteJson(request)) return json({ error: 'Send JSON from the dashboard.' }, 415)
  const body = await request.json().catch(() => null)
  const parsed = parsePurchaseInput(body, todayIn(timeZoneOf(body?.tz)))
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  try {
    const result = await addPrepaidPurchase(parsed.value, adminId)
    if (result.notEnabled) return json({ state: 'not_enabled' }, 409)
    return result.ok ? json({ ok: true }) : json({ error: 'The purchase could not be saved.' }, 500)
  } catch {
    return json({ error: 'The purchase could not be saved.' }, 500)
  }
}
