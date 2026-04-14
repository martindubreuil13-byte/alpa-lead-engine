import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>
type SyncAgentLeadsParams = {
  supabase: SupabaseServerClient
  userId: string
  missionId: string
}

type LeadInsertPayload = Database['public']['Tables']['leads']['Insert']
type QueueLeadRow = Database['public']['Tables']['agent_lead_queue']['Row']
type ExistingLeadRow = Pick<Database['public']['Tables']['leads']['Row'], 'email' | 'website'>

function normalizeEmail(value: string | null | undefined) {
  const trimmed = String(value || '').trim().toLowerCase()
  return trimmed || null
}

export function normalizeDomain(url: string | null | undefined) {
  const raw = String(url || '').trim()
  if (!raw) return null

  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

export async function syncAgentLeadsToMain({
  supabase,
  userId,
  missionId,
}: SyncAgentLeadsParams) {
  try {
    const { data: queueLeads, error } = await supabase
      .from('agent_lead_queue')
      .select('*')
      .eq('user_id', userId)
      .eq('mission_id', missionId)
      .eq('qualification_status', 'qualified')

    if (error) {
      console.error('SYNC ERROR (ignored):', error)
      return { inserted: 0 }
    }

    if (!queueLeads?.length) return { inserted: 0 }

    const { data: existingLeads, error: existingLeadsError } = await supabase
      .from('leads')
      .select('email, website')
      .eq('user_id', userId)

    if (existingLeadsError) {
      console.error('SYNC ERROR (ignored):', existingLeadsError)
      return { inserted: 0 }
    }

    const existingEmails = new Set(
      (existingLeads || [])
        .map((lead: ExistingLeadRow) => normalizeEmail(lead.email))
        .filter((value): value is string => Boolean(value))
    )

    const existingDomains = new Set(
      (existingLeads || [])
        .map((lead: ExistingLeadRow) => normalizeDomain(lead.website))
        .filter((value): value is string => Boolean(value))
    )

    const pendingEmails = new Set<string>()
    const pendingDomains = new Set<string>()

    const newLeads = queueLeads.filter((lead: QueueLeadRow) => {
      const normalizedEmail = normalizeEmail(lead.email)
      const normalizedDomain = normalizeDomain(lead.website)

      const emailExists = normalizedEmail
        ? existingEmails.has(normalizedEmail) || pendingEmails.has(normalizedEmail)
        : false
      const domainExists = normalizedDomain
        ? existingDomains.has(normalizedDomain) || pendingDomains.has(normalizedDomain)
        : false

      if (emailExists || domainExists) {
        return false
      }

      if (normalizedEmail) pendingEmails.add(normalizedEmail)
      if (normalizedDomain) pendingDomains.add(normalizedDomain)
      return true
    })

    if (!newLeads.length) return { inserted: 0 }

    const mapped: LeadInsertPayload[] = newLeads.map((lead: QueueLeadRow) => ({
      user_id: lead.user_id,
      company_name: String(lead.business_name || '').trim() || 'Untitled business',
      email: normalizeEmail(lead.email),
      phone: lead.phone?.trim() || null,
      website: lead.website?.trim() || null,
      city: lead.location?.trim() || null,
      status: 'inbox',
      source: 'agent',
      email_source: 'agent mission',
      email_confidence: 'low',
      is_generic_email: false,
      cost_estimate: 0,
    }))

    try {
      await supabase.rpc('pg_notify', {
        channel: 'pgrst',
        payload: 'reload schema',
      })
    } catch {}

    try {
      const { error: insertError } = await supabase
        .from('leads')
        .insert(mapped)

      if (insertError) {
        console.error('SYNC ERROR (ignored):', insertError)
        return { inserted: 0 }
      }
    } catch (err) {
      console.error('SYNC ERROR (ignored):', err)
      return { inserted: 0 }
    }

    return {
      inserted: mapped.length,
    }
  } catch (err) {
    console.error('SYNC ERROR (ignored):', err)
    return { inserted: 0 }
  }
}
