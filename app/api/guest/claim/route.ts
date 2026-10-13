import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { isFree } from '@/lib/auth/access'
import { guestDb, guestSession, loadGuestSession } from '@/lib/guest/server'
import { sameOrigin } from '@/lib/guest/security'
import { buildStoredWebsiteFacts, type StoredWebsiteFacts } from '@/lib/leads/stored-website-facts'
import { FREE_TRIAL_LEAD_LIMIT, type TrialLead } from '@/lib/trial'
import type { UserProfile } from '@/lib/supabase/types'

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
}

type GuestClaimResponse = {
  success: true
  imported: number
  skipped_invalid: number
  skipped_duplicate: number
  /** Businesses not imported because a free account already holds its 25 (the free allowance is never reset by signing up). */
  skipped_allowance: number
  /** Businesses already imported earlier whose website facts were added now. */
  backfilled: number
}

type ExistingLead = { id: string; company_name: string; email: string | null; phone: string | null; website: string | null; city: string | null; website_facts?: unknown }

// A column the database does not have yet (the facts column is added by an additive migration) must never break signup.
const isMissingColumn = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error && (error.code === '42703' || error.code === 'PGRST204' || /website_facts/.test(error.message || '')))

function buildLeadKey(lead: Pick<TrialLead, 'company_name' | 'email' | 'phone' | 'website' | 'city'>) {
  const email = lead.email?.trim().toLowerCase() || ''
  const phone = lead.phone?.trim().toLowerCase() || ''

  return [
    lead.company_name.trim().toLowerCase(),
    email,
    phone,
    (lead.website || '').trim().toLowerCase(),
    (lead.city || '').trim().toLowerCase(),
  ].join('::')
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
  }
}

// Brings a signed-in customer's own free-trial businesses into their account, with what ALPA learned about each from its own website.
// It reads only the server-held trial (never anything the browser sends), links that trial to this account, and imports through the
// customer's own session. Signing up never adds free allowance: one trial per account, and a free account is filled only up to the
// 25 businesses it is entitled to (the same count discovery uses), so a trial can neither reset nor stack on top of it.
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

  const empty: GuestClaimResponse = { success: true, imported: 0, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 0, backfilled: 0 }

  // One free trial per account. A second trial (another browser, cleared cookies) is not imported on top of the first.
  const { data: otherTrials } = await guestDb().from('guest_trials').select('id').eq('owner_user_id', user.id).neq('id', id).limit(1)
  if (otherTrials && otherTrials.length > 0) {
    return NextResponse.json(empty)
  }

  const { data: linkedRows, error: linkError } = await guestDb().from('guest_trials').update({ owner_user_id: user.id }).eq('id', id)
    .or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`).select('id')
  if (!linkedRows?.length || linkError) return NextResponse.json({ error: 'Your trial could not be saved to your account.' }, { status: 503 })
  const leads = (trial.leads as TrialLead[]).slice(0, FREE_TRIAL_LEAD_LIMIT)

  if (leads.length === 0) {
    return NextResponse.json(empty)
  }

  // The account's own plan decides whether it is held to the free allowance.
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('plan, plan_status, subscription_status, cancel_at_period_end, current_period_end')
    .eq('id', user.id)
    .maybeSingle()
  const free = isFree({ id: user.id, ...(profileRow ?? {}) } as unknown as UserProfile)

  let factsColumn = true
  let existingResult: { data: unknown[] | null; error: { code?: string; message?: string } | null } = await supabase
    .from('leads')
    .select('id, company_name, email, phone, website, city, website_facts')
    .eq('user_id', user.id)
  if (existingResult.error && isMissingColumn(existingResult.error)) {
    factsColumn = false
    existingResult = await supabase.from('leads').select('id, company_name, email, phone, website, city').eq('user_id', user.id)
  }
  if (existingResult.error) {
    return NextResponse.json({ error: 'Your saved businesses could not be read.' }, { status: 500 })
  }
  const existingLeads = (existingResult.data || []) as ExistingLead[]

  const existingByKey = new Map<string, ExistingLead>(existingLeads.map((row) => [buildLeadKey(row as TrialLead), row]))
  const libraryCount = existingLeads.filter((row) => Boolean(row.email?.trim() || row.phone?.trim())).length
  let allowanceLeft = free ? Math.max(0, FREE_TRIAL_LEAD_LIMIT - libraryCount) : Number.POSITIVE_INFINITY

  const newRows: GuestLeadInsertPayload[] = []
  const backfill: Array<{ id: string; facts: StoredWebsiteFacts }> = []
  let skippedInvalid = 0
  let skippedDuplicate = 0
  let skippedAllowance = 0

  for (const lead of leads) {
    const email = lead.email?.trim() || null
    const phone = lead.phone?.trim() || null

    if (!email && !phone) {
      skippedInvalid += 1
      continue
    }

    const facts = factsColumn ? buildStoredWebsiteFacts(lead) : null
    const key = buildLeadKey({ ...lead, email, phone })
    const existing = existingByKey.get(key)

    if (existing) {
      skippedDuplicate += 1
      // Imported before the facts were kept, or without them: add them now, never overwriting anything already there.
      if (facts && factsColumn && existing.website_facts == null) backfill.push({ id: existing.id, facts })
      continue
    }

    if (allowanceLeft <= 0) {
      skippedAllowance += 1
      continue
    }

    const payload = buildGuestLeadInsertPayload({ ...lead, email, phone } as TrialLead, user.id, facts)
    if (!payload) {
      skippedInvalid += 1
      continue
    }

    existingByKey.set(key, { id: '', company_name: lead.company_name, email, phone, website: lead.website, city: lead.city })
    allowanceLeft -= 1
    newRows.push(payload)
  }

  let imported = 0
  if (newRows.length > 0) {
    let result = await supabase.from('leads').insert(newRows).select('id')
    if (result.error && isMissingColumn(result.error)) {
      // The facts column is not there yet: import the businesses exactly as before; a later sign-in adds the facts.
      result = await supabase.from('leads').insert(newRows.map(({ website_facts: _facts, ...row }) => row)).select('id')
    }
    if (result.error) {
      console.error('DB ERROR:', JSON.stringify(result.error, null, 2))
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }
    if (!result.data) {
      return NextResponse.json({ error: 'Insert succeeded without returned rows' }, { status: 500 })
    }
    imported = result.data.length
  }

  let backfilled = 0
  for (const item of backfill) {
    const { data, error } = await supabase
      .from('leads')
      .update({ website_facts: item.facts })
      .eq('id', item.id)
      .eq('user_id', user.id)
      .is('website_facts', null)
      .select('id')
    if (!error && data && data.length > 0) backfilled += 1
  }

  const response: GuestClaimResponse = {
    success: true,
    imported,
    skipped_invalid: skippedInvalid,
    skipped_duplicate: skippedDuplicate,
    skipped_allowance: skippedAllowance,
    backfilled,
  }
  console.info(response)
  return NextResponse.json(response)
}
