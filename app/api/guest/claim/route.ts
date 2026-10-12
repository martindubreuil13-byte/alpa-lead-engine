import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { FREE_TRIAL_LEAD_LIMIT, type TrialLead } from '@/lib/trial'
import { guestDb, guestSession, loadGuestSession } from '@/lib/guest/server'
import { sameOrigin } from '@/lib/guest/security'

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
}

type GuestClaimResponse = {
  success: true
  imported: number
  skipped_invalid: number
  skipped_duplicate: number
}

function buildLeadKey(
  lead: Pick<TrialLead, 'company_name' | 'email' | 'phone' | 'website' | 'city'>
) {
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

function buildGuestLeadInsertPayload(lead: TrialLead, userId: string): GuestLeadInsertPayload | null {
  const email = lead.email?.trim() || null
  const phone = lead.phone?.trim() || null

  if (!userId || !lead.company_name || (!email && !phone)) {
    return null
  }

  const payload: GuestLeadInsertPayload = {
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
  }

  if (!payload.source) payload.source = 'serper'
  if (!payload.email_confidence) payload.email_confidence = 'low'
  if (payload.is_generic_email === undefined) payload.is_generic_email = false

  return payload
}

function buildGuestClaimResponse(
  imported: number,
  skippedInvalid: number,
  skippedDuplicate: number
): GuestClaimResponse {
  return {
    success: true,
    imported,
    skipped_invalid: skippedInvalid,
    skipped_duplicate: skippedDuplicate,
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({error:'Request origin refused'},{status:403})
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
  if (!id) return NextResponse.json({error:'No guest session'},{status:401})
  const trial = await loadGuestSession(id)
  const {data:linkedRows,error:linkError} = await guestDb().from('guest_trials').update({owner_user_id:user.id}).eq('id',id)
   .or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`).select('id')
  if(!linkedRows?.length || linkError) return NextResponse.json({error:'Your trial could not be saved to your account.'},{status:503})
  const leads = trial.leads as TrialLead[]

  if (leads.length === 0) {
    return NextResponse.json(buildGuestClaimResponse(0, 0, 0))
  }

  const limitedLeads = leads.slice(0, FREE_TRIAL_LEAD_LIMIT)

  const { data: existingLeads, error: existingError } = await supabase
    .from('leads')
    .select('company_name, email, phone, website, city')
    .eq('user_id', user.id)

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const existingKeys = new Set((existingLeads || []).map(buildLeadKey))
  const newRows: GuestLeadInsertPayload[] = []
  let skippedInvalid = 0
  let skippedDuplicate = 0

  for (const lead of limitedLeads) {
    const email = lead.email?.trim() || null
    const phone = lead.phone?.trim() || null

    if (!email && !phone) {
      skippedInvalid += 1
      console.warn('Skipping invalid lead (no contact)', lead)
      continue
    }

    const leadKey = buildLeadKey({
      ...lead,
      email,
      phone,
    })

    if (existingKeys.has(leadKey)) {
      skippedDuplicate += 1
      continue
    }

    const payload = buildGuestLeadInsertPayload(
      {
        ...lead,
        email,
        phone,
      },
      user.id
    )

    if (!payload) {
      skippedInvalid += 1
      console.warn('Skipping invalid lead (no contact)', lead)
      continue
    }

    existingKeys.add(leadKey)
    newRows.push(payload)
  }

  if (newRows.length === 0) {
    const imported = 0
    const response = {
      success: true,
      imported,
      skipped_invalid: skippedInvalid,
      skipped_duplicate: skippedDuplicate,
    } satisfies GuestClaimResponse
    console.info(response)
    return NextResponse.json(response)
  }

  const { data, error } = await supabase
    .from('leads')
    .insert(newRows)
    .select('id')

  if (error) {
    console.error('DB ERROR:', JSON.stringify(error, null, 2))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Insert succeeded without returned rows' }, { status: 500 })
  }

  const imported = data.length
  const response = {
    success: true,
    imported,
    skipped_invalid: skippedInvalid,
    skipped_duplicate: skippedDuplicate,
  } satisfies GuestClaimResponse
  console.info(response)
  return NextResponse.json(response)
}
