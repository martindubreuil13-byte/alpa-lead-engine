import { isResearchEnabled } from './research-switch.ts'

// The generated database types do not know the Phase 1 functions yet, so the client is deliberately untyped here.
type RpcClient = any

export type EffectiveResearchStatus = {
  /** Research can start only if BOTH switches are on and every budget is configured. */
  running: boolean
  environmentSwitch: boolean
  /** Null when the database could not be read (treated as not running). */
  databaseSwitch: boolean | null
  budgetsConfigured: boolean | null
  database: Record<string, unknown> | null
}

/**
 * Whether research is really running right now. Reads the environment switch and the database switch; any failure to
 * read the database means "not running". It never starts research and writes nothing.
 */
export async function getEffectiveResearchStatus(adminClient: RpcClient | null, env: Record<string, string | undefined> = process.env): Promise<EffectiveResearchStatus> {
  const environmentSwitch = isResearchEnabled(env)
  let database: Record<string, unknown> | null = null
  try {
    if (adminClient) {
      const { data, error } = await adminClient.rpc('get_ci_research_status')
      if (!error && data && typeof data === 'object') database = data as Record<string, unknown>
    }
  } catch {
    database = null
  }
  const databaseSwitch = database ? database.enabled === true : null
  const budgetsConfigured = database ? database.budgets_configured === true : null
  return { running: environmentSwitch && databaseSwitch === true && budgetsConfigured === true, environmentSwitch, databaseSwitch, budgetsConfigured, database }
}
