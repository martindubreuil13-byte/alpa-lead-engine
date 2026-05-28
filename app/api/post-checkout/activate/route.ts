import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

import { FREE_TRIAL_LEAD_LIMIT, type TrialLead } from '@/lib/trial'
import { STRIPE_API_VERSION } from '@/lib/stripe'
import { syncSubscriptionToDatabase } from '@/lib/stripe/subscription'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ActivateRequestBody = {
  sessionId?: string
  cleanWorkspace?: boolean
  leads?: TrialLead[]
}

type LeadInsertPayload = {
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
}

function buildLeadKey(
  lead: Pick<TrialLead, 'company_name' | 'email' | 'phone' | 'website' | 'city'>
) {
  return [
    lead.company_name.trim().toLowerCase(),
    lead.email?.trim().toLowerCase() || '',
    lead.phone?.trim().toLowerCase() || '',
    (lead.website || '').trim().toLowerCase(),
    (lead.city || '').trim().toLowerCase(),
  ].join('::')
}

function buildLeadInsertPayload(lead: TrialLead, userId: string): LeadInsertPayload | null {
  const email = lead.email?.trim() || null
  const phone = lead.phone?.trim() || null

  if (!userId || !lead.company_name || (!email && !phone)) {
    return null
  }

  return {
    user_id: userId,
    company_name: lead.company_name,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    website: lead.website || null,
    city: lead.city || null,
    status: 'inbox',
    source: (lead.source as LeadInsertPayload['source']) || 'serper',
    email_confidence: 'low',
    email_source: lead.email_source || lead.website || 'post_checkout_import',
    is_generic_email: lead.is_generic_email ?? false,
    cost_estimate: lead.cost_estimate ?? 0,
  }
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) {
  if (!customer) {
    return ''
  }

  return typeof customer === 'string' ? customer.trim() : customer.id.trim()
}

function getSubscriptionId(
  subscription: string | Stripe.Subscription | null | undefined
) {
  if (!subscription) {
    return ''
  }

  return typeof subscription === 'string' ? subscription.trim() : subscription.id.trim()
}

function isCheckoutUnlocked(session: Stripe.Checkout.Session) {
  return (
    session.mode === 'subscription' &&
    session.status === 'complete' &&
    session.payment_status !== 'unpaid'
  )
}

export async function POST(req: Request) {
  try {
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
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as ActivateRequestBody | null
    const sessionId = String(body?.sessionId || '').trim()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing checkout session id' }, { status: 400 })
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    if (!isCheckoutUnlocked(session)) {
      return NextResponse.json({ error: 'Checkout is not complete' }, { status: 400 })
    }

    const customerId = getCustomerId(
      session.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
    )
    const subscriptionId = getSubscriptionId(
      session.subscription as string | Stripe.Subscription | null
    )
    const subscription = subscriptionId
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : null

    if (body?.cleanWorkspace) {
      const { error: leadsDeleteError } = await admin.from('leads').delete().eq('user_id', user.id)

      if (leadsDeleteError) {
        return NextResponse.json({ error: leadsDeleteError.message }, { status: 500 })
      }

      const { error: pipelineDeleteError } = await admin.from('pipeline').delete().eq('user_id', user.id)
      console.log('Pipeline cleaned for user:', user.id)

      if (
        pipelineDeleteError &&
        !/relation .*pipeline.* does not exist|Could not find the table/i.test(
          pipelineDeleteError.message || ''
        )
      ) {
        return NextResponse.json({ error: pipelineDeleteError.message }, { status: 500 })
      }
    }

    if (subscription) {
      await syncSubscriptionToDatabase(subscription, { userId: user.id, customerId })
    }

    const leadsToImport = Array.isArray(body?.leads) ? body.leads.slice(0, FREE_TRIAL_LEAD_LIMIT) : []

    if (leadsToImport.length > 0) {
      const { data: existingLeads, error: existingError } = await admin
        .from('leads')
        .select('company_name, email, phone, website, city')
        .eq('user_id', user.id)

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 })
      }

      const existingKeys = new Set((existingLeads || []).map(buildLeadKey))
      const rowsToInsert: LeadInsertPayload[] = []

      for (const lead of leadsToImport) {
        const leadKey = buildLeadKey(lead)
        if (existingKeys.has(leadKey)) {
          continue
        }

        const payload = buildLeadInsertPayload(lead, user.id)
        if (!payload) {
          continue
        }

        existingKeys.add(leadKey)
        rowsToInsert.push(payload)
      }

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await admin.from('leads').insert(rowsToInsert)

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to activate account'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
