import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { guestDb, guestSession, loadGuestSession } from '@/lib/guest/server'
import { sameOrigin } from '@/lib/guest/security'
import { buildStoredWebsiteFacts, type StoredWebsiteFacts } from '@/lib/leads/stored-website-facts'
import { readStoredLightProfile, type LightProfile } from '@/lib/guest/light-profile'
import { FREE_TRIAL_LEAD_LIMIT, type TrialLead } from '@/lib/trial'

type GuestLeadInsertPayload = {
  user_id: string
  company_name: string
  email?: string
  phone?: string
  website: string | null
  city: string | null
  status: 'inbox'
  source: 'serper' | 'google' | 'hybrid'
  email_confidence: 'high' | 'medium' | 'low'
  email_source: string
  is_generic_email: boolean
  cost_estimate: number
  industry: string | null
  website_facts?: StoredWebsiteFacts
  light_profile?: LightProfile
}

function buildGuestLeadInsertPayload(lead: TrialLead, userId: string, facts: StoredWebsiteFacts | null): GuestLeadInsertPayload | null {
  const email = lead.email?.trim() || null
  const phone = lead.phone?.trim() || null

  if (!userId || !lead.company_name || (!email && !phone)) {
    return null
  }

  return {
    user_id: userId,
    company_name: lead.company_name,
    industry: lead.industry,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    website: lead.website,
    city: lead.city,
    status: 'inbox',
    source: (lead.source as GuestLeadInsertPayload['source']) || 'serper',
    email_confidence: lead.email_confidence || 'low',
    email_source: lead.email_source || lead.website || 'guest_import',
    is_generic_email: lead.is_generic_email ?? false,
    cost_estimate: lead.cost_estimate ?? 0,
    ...(facts ? { website_facts: facts } : {}),
    // The short profile written during the trial travels with the business (read back through the same validator as any stored value).
    ...(readStoredLightProfile(lead.light_profile) ? { light_profile: readStoredLightProfile(lead.light_profile)! } : {}),
  }
}

// Identity and the signed trial cookie are verified here; ownership, deduplication, lifetime quota
// and insertion commit together in the service-only RPC. There is no non-atomic fallback.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Request origin refused' }, { status: 403 })
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = await guestSession()
  if (!id) return NextResponse.json({ error: 'No guest session' }, { status: 401 })
  let trial: Awaited<ReturnType<typeof loadGuestSession>>
  try {
    trial = await loadGuestSession(id)
  } catch {
    return NextResponse.json({ error: 'This trial has expired.' }, { status: 410 })
  }

  const payloads = (trial.leads as TrialLead[]).slice(0, FREE_TRIAL_LEAD_LIMIT).map((lead) =>
    buildGuestLeadInsertPayload(lead, user.id, buildStoredWebsiteFacts(lead)) ?? {}
  )
  const { data, error } = await guestDb().rpc('claim_guest_businesses', {
    p_user_id: user.id,
    p_trial_id: id,
    p_leads: payloads,
  })
  if (error || !data) {
    // A missing migration, rollback or lost confirmation must never cause an ordinary insert.
    // The same signed trial can be retried safely; guest results are retained.
    return NextResponse.json({ error: 'Your trial could not be saved right now. Please try again.' }, { status: 503 })
  }
  return NextResponse.json(data)
}
