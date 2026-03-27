import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { FREE_TRIAL_LEAD_LIMIT, type TrialLead } from '@/lib/trial'

type GuestLeadInsertPayload = {
  user_id: string
  company_name: string
  email: string | null
  phone: string | null
  website: string | null
  city: string | null
  status: 'inbox'
  source: 'serper' | 'google' | 'hybrid'
  email_confidence: 'high' | 'medium' | 'low'
  email_source: string
  is_generic_email: boolean
  cost_estimate: number
}

function buildLeadKey(lead: Pick<TrialLead, 'company_name' | 'email' | 'website' | 'city'>) {
  return [
    lead.company_name.trim().toLowerCase(),
    (lead.email || '').trim().toLowerCase(),
    (lead.website || '').trim().toLowerCase(),
    (lead.city || '').trim().toLowerCase(),
  ].join('::')
}

function buildGuestLeadInsertPayload(lead: TrialLead, userId: string): GuestLeadInsertPayload | null {
  if (!userId || !lead.company_name) {
    return null
  }

  const payload: GuestLeadInsertPayload = {
    user_id: userId,
    company_name: lead.company_name,
    email: lead.email,
    phone: lead.phone,
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

export async function POST(req: Request) {
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

  const body = await req.json().catch(() => null)
  const leads = Array.isArray(body?.leads) ? (body.leads as TrialLead[]) : []

  if (leads.length === 0) {
    return NextResponse.json({ success: true, imported: 0 })
  }

  const limitedLeads = leads.slice(0, FREE_TRIAL_LEAD_LIMIT)

  const { data: existingLeads, error: existingError } = await supabase
    .from('leads')
    .select('company_name, email, website, city')
    .eq('user_id', user.id)

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const existingKeys = new Set((existingLeads || []).map(buildLeadKey))
  const newRows = limitedLeads
    .filter((lead) => !existingKeys.has(buildLeadKey(lead)))
    .map((lead) => {
      const payload = buildGuestLeadInsertPayload(lead, user.id)

      if (!payload) {
        console.log('invalid lead skipped')
        return null
      }

      return payload
    })
    .filter((lead): lead is GuestLeadInsertPayload => Boolean(lead))

  if (newRows.length === 0) {
    return NextResponse.json({ success: true, imported: 0 })
  }

  console.log('INSERT PAYLOAD:', newRows)

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

  data.forEach((row) => {
    console.log('DB INSERT OK:', row.id)
  })

  return NextResponse.json({ success: true, imported: data.length })
}
