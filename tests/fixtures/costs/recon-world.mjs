// A fake administrator check and database for the cost routes: records every write so tests can prove which tables were touched.
export const world = { admin: 'admin', writes: [], reconciliations: new Map(), purchases: [], estimates: { serper: { requests: 120, credits: 360, cost: 0.36, unpriced: 0 }, google_places: { requests: 400, credits: 0, cost: 12.4, unpriced: 0 } }, rpcError: null, adminEmail: 'owner@example.com', editCalls: [] }
export const reset = () => { world.admin = 'admin'; world.writes.length = 0; world.reconciliations.clear(); world.purchases.length = 0; world.rpcError = null; world.editCalls.length = 0 }

export const requireAdmin = async () => {
  if (world.admin === 'admin') return { userId: '11111111-1111-4111-8111-111111111111', error: null }
  const status = world.admin === 'anonymous' ? 401 : 403
  return { userId: null, error: new Response(JSON.stringify({ error: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' }), { status, headers: { 'content-type': 'application/json' } }) }
}
export const createServerClient = async () => ({ auth: { getUser: async () => ({ data: { user: { email: world.adminEmail } } }) } })

const derive = (row) => ({ ...row, billed_usd: row.billed_amount === null || row.billed_amount === undefined ? null : Math.round(row.billed_amount * row.exchange_rate_to_usd * 1e4) / 1e4 })
export const createAdminClient = () => ({
  rpc: async (name, args) => {
    if (world.rpcError) return { data: null, error: world.rpcError }
    if (name === 'admin_edit_prepaid_purchase') {
      world.writes.push({ table: 'rpc:admin_edit_prepaid_purchase', op: 'rpc', row: args })
      world.editCalls.push(args)
      const p = world.purchases.find((x, i) => i + 1 === args.p_id)
      if (!p) return { data: { status: 'not_found' }, error: null }
      p.history ??= []
      if (p.history.some((h) => h.request_key === args.p_request_key)) return { data: { status: 'duplicate', version: p.version ?? 1 }, error: null }
      if ((p.version ?? 1) !== args.p_expected_version) return { data: { status: 'stale', version: p.version ?? 1 }, error: null }
      p.history.push({ request_key: args.p_request_key, replaced_version: p.version ?? 1, purchased_on: p.purchased_on, amount_paid: p.amount_paid, currency: p.currency, exchange_rate_to_usd: p.exchange_rate_to_usd, amount_usd: Math.round(p.amount_paid * p.exchange_rate_to_usd * 1e4) / 1e4, credits: p.credits, note: p.note, changed_by_label: args.p_admin_label, changed_at: new Date().toISOString() })
      Object.assign(p, { purchased_on: args.p_purchased_on, amount_paid: args.p_amount_paid, currency: args.p_currency, exchange_rate_to_usd: args.p_rate, credits: args.p_credits, note: args.p_note, version: (p.version ?? 1) + 1, updated_at: new Date().toISOString() })
      return { data: { status: 'updated', version: p.version }, error: null }
    }
    if (name !== 'admin_reconciliation_overview') return { data: null, error: { code: 'PGRST202', message: 'not found' } }
    const month = `${args.p_month.slice(0, 7)}-01`
    return {
      error: null,
      data: {
        month,
        estimated: Object.entries(world.estimates).map(([provider, e]) => ({ provider, ...e })),
        reconciliations: [...world.reconciliations.values()].filter((r) => r.billing_month === month).map((r) => { const { updated_by, ...rest } = derive(r); return rest }),
        purchases: world.purchases.map((p, i) => { const { request_key, created_by, ...rest } = p; return { id: i + 1, version: 1, history: [], ...rest, history: (p.history ?? []).map(({ request_key: k, ...h }) => h), amount_usd: Math.round(p.amount_paid * p.exchange_rate_to_usd * 1e4) / 1e4 } }),
      },
    }
  },
  from: (table) => ({
    upsert: async (row, options) => {
      world.writes.push({ table, op: 'upsert', row, options })
      if (table === 'api_billing_reconciliations') world.reconciliations.set(`${row.billing_month}:${row.provider}`, row)
      // the real table's unique request_key: an ignored duplicate stores nothing
      if (table === 'api_prepaid_purchases' && options?.ignoreDuplicates && !world.purchases.some((p) => p.request_key === row.request_key)) world.purchases.push({ ...row, version: 1 })
      return { error: null }
    },
    insert: async (row) => {
      world.writes.push({ table, op: 'insert', row })
      return { error: null }
    },
  }),
})
