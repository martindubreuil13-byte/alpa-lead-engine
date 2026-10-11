import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadInsertPayload } from './lead-payload.ts'

export type DiscoverCapacity = {
  leads_used: number
  leads_limit: number
  current_period_end: string | null
}

export type DiscoverSaveOutcome = {
  index: number
  status: 'saved' | 'duplicate' | 'invalid' | 'failed' | 'limit'
  id?: string
}

export type DiscoverSaveResult = DiscoverCapacity & { outcomes: DiscoverSaveOutcome[] }

function capacity(value: unknown): DiscoverCapacity {
  const row = value as DiscoverCapacity | null
  if (!row || !Number.isInteger(row.leads_used) || row.leads_used < 0 ||
      !Number.isInteger(row.leads_limit) || row.leads_limit < 0 ||
      (row.current_period_end !== null && typeof row.current_period_end !== 'string')) {
    throw new Error('Discover accounting returned an invalid response')
  }
  return row
}

/** Server-only callers supply verified identity and plan; SQL is service-role only. */
export async function getDiscoverCapacity(
  client: SupabaseClient<any>, userId: string, limit: number, monthly: boolean
): Promise<DiscoverCapacity> {
  const { data, error } = await client.rpc('get_discover_capacity', {
    p_user_id: userId, p_leads_limit: limit, p_monthly: monthly,
  })
  if (error) throw new Error('Lead accounting is unavailable. No search was started.')
  return capacity(data)
}

/** A replay uses the same run ID and payload. Never fall back to non-atomic inserts. */
export async function saveDiscoverResults(
  client: SupabaseClient<any>, input: {
    runId: string; userId: string; limit: number; monthly: boolean; leads: LeadInsertPayload[]
  }
): Promise<DiscoverSaveResult> {
  const args = {
    p_run_id: input.runId, p_user_id: input.userId, p_leads_limit: input.limit,
    p_monthly: input.monthly, p_leads: input.leads,
  }
  // A transport failure may happen after COMMIT. The durable receipt makes this retry safe.
  let response = await client.rpc('save_discover_results', args)
  if (response.error) response = await client.rpc('save_discover_results', args)
  if (response.error) {
    throw new Error(`Saving could not be confirmed. Reference: ${input.runId}. Check your saved leads before starting another search.`)
  }
  const result = response.data as DiscoverSaveResult
  capacity(result)
  const statuses = new Set(['saved', 'duplicate', 'invalid', 'failed', 'limit'])
  if (!Array.isArray(result.outcomes) || result.outcomes.length !== input.leads.length ||
      result.outcomes.some((outcome, index) => outcome.index !== index || !statuses.has(outcome.status) ||
        (outcome.status === 'saved' && typeof outcome.id !== 'string'))) {
    throw new Error('Saving returned an invalid confirmation. Check your saved leads before repeating the search.')
  }
  return result
}

export function describeLeadUsage(count: number, limit: string, monthly: boolean) {
  return `${count} of ${limit} leads saved${monthly ? ' this month' : ''}`
}
