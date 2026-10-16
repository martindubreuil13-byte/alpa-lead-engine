import { createAdminClient } from '@/lib/supabase/admin'
import { isValidTimeZone } from '@/lib/costs/report'
import { buildReconciliationView, type PurchaseEditInput, type PurchaseInput, type RawReconciliation, type ReconciliationInput, type ReconciliationView } from '@/lib/costs/reconcile'

export type ReconciliationResult =
  | { state: 'ready'; view: ReconciliationView }
  | { state: 'not_enabled' }
  | { state: 'error'; message: string }

const isMissingObject = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find the function|schema cache/i.test(error.message ?? '')))

export const todayIn = (tz: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: isValidTimeZone(tz) ? tz : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

export async function loadReconciliation(month: string, tz: string): Promise<ReconciliationResult> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('admin_reconciliation_overview', { p_month: month, p_tz: tz })
  if (error) return isMissingObject(error) ? { state: 'not_enabled' } : { state: 'error', message: 'The reconciliation could not be loaded.' }
  return { state: 'ready', view: buildReconciliationView(data as RawReconciliation) }
}

/**
 * Saves a verified billed amount for one provider and month. Only the reconciliation row is written: the request-level usage records are
 * never read for update, and the estimate at the time is stored beside the figure so a later change in the estimate is visible.
 */
export async function saveReconciliation(input: ReconciliationInput, adminId: string, tz: string): Promise<ReconciliationResult> {
  const admin = createAdminClient() as any
  const current = await admin.rpc('admin_reconciliation_overview', { p_month: input.billingMonth, p_tz: tz })
  if (current.error) return isMissingObject(current.error) ? { state: 'not_enabled' } : { state: 'error', message: 'The reconciliation could not be saved.' }
  const estimate = Number((current.data as RawReconciliation).estimated?.find((row) => row.provider === input.provider)?.cost ?? 0)
  const reconciled = input.billedAmount !== null

  const { error } = await admin.from('api_billing_reconciliations').upsert(
    {
      billing_month: input.billingMonth,
      provider: input.provider,
      status: reconciled ? 'reconciled' : 'pending',
      billed_amount: input.billedAmount,
      billed_currency: input.currency,
      exchange_rate_to_usd: input.exchangeRateToUsd,
      reported_credits: input.reportedCredits,
      reconciled_on: input.reconciledOn,
      estimated_usd_at_reconciliation: reconciled ? estimate : null,
      note: input.note,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'billing_month,provider' }
  )
  if (error) return { state: 'error', message: 'The reconciliation could not be saved.' }
  return loadReconciliation(input.billingMonth, tz)
}

/** Adds a purchase. The same request key stored twice is one purchase: a double submission does nothing the second time. */
export async function addPrepaidPurchase(input: PurchaseInput, adminId: string): Promise<{ ok: boolean; notEnabled?: boolean }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('api_prepaid_purchases').upsert({
    request_key: input.requestKey, provider: input.provider, purchased_on: input.purchasedOn, amount_paid: input.amountPaid, currency: input.currency,
    exchange_rate_to_usd: input.exchangeRateToUsd, credits: input.credits, note: input.note, created_by: adminId,
  }, { onConflict: 'request_key', ignoreDuplicates: true })
  if (error) return isMissingObject(error) ? { ok: false, notEnabled: true } : { ok: false }
  return { ok: true }
}

export type EditOutcome =
  | { status: 'updated' | 'duplicate' | 'unchanged'; version: number }
  | { status: 'stale'; version: number }
  | { status: 'not_found' }
  | { status: 'not_enabled' }
  | { status: 'error' }

/**
 * Corrects a purchase through the audited database function: the previous values are kept in the history first, in the same transaction.
 * That function reads and writes only the purchase and its history, so no usage record, estimate or reconciliation can change.
 */
export async function editPrepaidPurchase(id: number, input: PurchaseEditInput, admin: { id: string; label: string | null }): Promise<EditOutcome> {
  const client = createAdminClient() as any
  const { data, error } = await client.rpc('admin_edit_prepaid_purchase', {
    p_id: id, p_expected_version: input.expectedVersion, p_purchased_on: input.purchasedOn, p_amount_paid: input.amountPaid, p_currency: input.currency,
    p_rate: input.exchangeRateToUsd, p_credits: input.credits, p_note: input.note, p_admin: admin.id, p_admin_label: admin.label, p_request_key: input.requestKey,
  })
  if (error) return isMissingObject(error) ? { status: 'not_enabled' } : { status: 'error' }
  const status = (data as { status?: string })?.status
  const version = Number((data as { version?: number })?.version)
  if (status === 'updated' || status === 'duplicate' || status === 'unchanged') return { status, version }
  if (status === 'stale') return { status, version }
  if (status === 'not_found') return { status: 'not_found' }
  return { status: 'error' }
}
