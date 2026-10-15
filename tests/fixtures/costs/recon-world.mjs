// A fake administrator check and database for the cost routes: records every write so tests can prove which tables were touched.
export const world = { admin: 'admin', writes: [], reconciliations: new Map(), purchases: [], estimates: { serper: { requests: 120, credits: 360, cost: 0.36, unpriced: 0 }, google_places: { requests: 400, credits: 0, cost: 12.4, unpriced: 0 } }, rpcError: null }
export const reset = () => { world.admin = 'admin'; world.writes.length = 0; world.reconciliations.clear(); world.purchases.length = 0; world.rpcError = null }

export const requireAdmin = async () => {
  if (world.admin === 'admin') return { userId: '11111111-1111-4111-8111-111111111111', error: null }
  const status = world.admin === 'anonymous' ? 401 : 403
  return { userId: null, error: new Response(JSON.stringify({ error: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' }), { status, headers: { 'content-type': 'application/json' } }) }
}
export const createServerClient = async () => ({})

const derive = (row) => ({ ...row, billed_usd: row.billed_amount === null || row.billed_amount === undefined ? null : Math.round(row.billed_amount * row.exchange_rate_to_usd * 1e4) / 1e4 })
export const createAdminClient = () => ({
  rpc: async (name, args) => {
    if (world.rpcError) return { data: null, error: world.rpcError }
    if (name !== 'admin_reconciliation_overview') return { data: null, error: { code: 'PGRST202', message: 'not found' } }
    const month = `${args.p_month.slice(0, 7)}-01`
    return {
      error: null,
      data: {
        month,
        estimated: Object.entries(world.estimates).map(([provider, e]) => ({ provider, ...e })),
        reconciliations: [...world.reconciliations.values()].filter((r) => r.billing_month === month).map((r) => { const { updated_by, ...rest } = derive(r); return rest }),
        purchases: world.purchases.map((p, i) => ({ id: i + 1, ...p, amount_usd: Math.round(p.amount_paid * p.exchange_rate_to_usd * 1e4) / 1e4 })),
      },
    }
  },
  from: (table) => ({
    upsert: async (row, options) => {
      world.writes.push({ table, op: 'upsert', row, options })
      if (table === 'api_billing_reconciliations') world.reconciliations.set(`${row.billing_month}:${row.provider}`, row)
      return { error: null }
    },
    insert: async (row) => {
      world.writes.push({ table, op: 'insert', row })
      if (table === 'api_prepaid_purchases') world.purchases.push(row)
      return { error: null }
    },
  }),
})
