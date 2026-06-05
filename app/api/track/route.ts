import { createClient } from '@supabase/supabase-js'

import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type TrackPayload = {
  session_id?: string
  search_id?: string
  event?: string
  email?: string
  query?: string
  location?: string
  leads_count?: number
  source_page?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  referrer?: string
  first_landing_page?: string
  device_type?: string
  browser?: string
  operating_system?: string
  search_query?: string
  business_type?: string
  filters_used?: Record<string, unknown>
  number_of_results_returned?: number
  number_of_results_with_email?: number
  number_of_results_with_phone?: number
  number_of_results_with_website?: number
  search_duration_ms?: number
  error_message?: string
  no_results?: boolean
  metadata?: Record<string, unknown>
}

function normalizeOptionalText(value: unknown) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function normalizeLeadsCount(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) ? count : null
}

function normalizeInteger(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0
}

function normalizeOptionalInteger(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : null
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeOptionalText(value)
  return normalized && /^[0-9a-fA-F-]{36}$/.test(normalized) ? normalized : null
}

function cleanMetadata(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getPostSearchFlag(event: string) {
  switch (event) {
    case 'results_viewed':
      return 'viewed_results'
    case 'lead_detail_viewed':
      return 'opened_lead_detail'
    case 'csv_downloaded':
      return 'downloaded_csv_after_search'
    case 'email_exported':
    case 'email_export_sent':
      return 'email_exported_after_search'
    case 'pricing_page_viewed':
    case 'plans_viewed':
      return 'viewed_pricing_after_search'
    case 'upgrade_clicked':
      return 'clicked_upgrade_after_search'
    default:
      return null
  }
}

function isMissingSchemaError(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return (
    error.code === '42703' ||
    error.code === '42P01' ||
    error.code === 'PGRST204' ||
    error.code === 'PGRST205' ||
    /column .* does not exist|schema cache|could not find the table/i.test(error.message || '')
  )
}

function isInternalAnalyticsEmail(email: string | null) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || ''
  return domain === 'mindrasolutions.com' || domain.endsWith('.mindrasolutions.com')
}

function getCohortField(event: string) {
  if (event === 'signup_completed') return 'signup_date'
  if (event === 'first_search_performed' || event === 'search_performed' || event === 'scrape_completed') return 'first_search_date'
  if (event === 'csv_downloaded' || event === 'email_exported' || event === 'email_export_sent') return 'first_export_date'
  if (event === 'upgrade_clicked') return 'first_upgrade_click_date'
  if (event === 'payment_completed' || event === 'checkout_completed') return 'paid_conversion_date'
  return null
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as TrackPayload

    const headerSessionId = req.headers.get('x-session-id')
    const sessionId =
      normalizeOptionalText(body.session_id) ||
      normalizeOptionalText(headerSessionId) ||
      crypto.randomUUID()
    const event = normalizeOptionalText(body.event)
    const searchId = normalizeUuid(body.search_id)

    if (!event) {
      return Response.json({ success: true })
    }

    const authClient = await createServerClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const email = normalizeOptionalText(body.email) || normalizeOptionalText(user?.email)
    const attributionPayload = {
      utm_source: normalizeOptionalText(body.utm_source),
      utm_medium: normalizeOptionalText(body.utm_medium),
      utm_campaign: normalizeOptionalText(body.utm_campaign),
      utm_content: normalizeOptionalText(body.utm_content),
      utm_term: normalizeOptionalText(body.utm_term),
      referrer: normalizeOptionalText(body.referrer),
      first_landing_page: normalizeOptionalText(body.first_landing_page),
      device_type: normalizeOptionalText(body.device_type),
      browser: normalizeOptionalText(body.browser),
      operating_system: normalizeOptionalText(body.operating_system),
    }
    const payload = {
      session_id: sessionId,
      search_id: searchId,
      user_id: normalizeOptionalText(user?.id),
      email,
      event,
      query: normalizeOptionalText(body.query),
      location: normalizeOptionalText(body.location),
      leads_count: normalizeLeadsCount(body.leads_count),
      metadata: cleanMetadata(body.metadata),
      source_page: normalizeOptionalText(body.source_page),
      ...attributionPayload,
    }

    const { error } = await supabase.from('activity_logs').insert(payload)

    if (error) {
      const legacyPayload = {
        session_id: payload.session_id,
        user_id: payload.user_id,
        email: payload.email,
        event: payload.event,
        query: payload.query,
        location: payload.location,
        leads_count: payload.leads_count,
        metadata: payload.metadata,
      }
      const { error: legacyError } = isMissingSchemaError(error)
        ? await supabase.from('activity_logs').insert(legacyPayload)
        : { error }

      if (legacyError) {
        console.error('activity tracking insert failed:', legacyError)
        return Response.json({ success: true })
      }
    }

    const userId = normalizeOptionalText(user?.id)

    const userAttributionPayload = {
      session_id: sessionId,
      ...(userId ? { user_id: userId } : {}),
      ...(email ? { email } : {}),
      analytics_excluded: isInternalAnalyticsEmail(email),
      ...Object.fromEntries(
        Object.entries(attributionPayload).filter(([, value]) => value !== null)
      ),
      updated_at: new Date().toISOString(),
    }
    const cohortField = getCohortField(event)
    if (cohortField) {
      ;(userAttributionPayload as Record<string, unknown>)[cohortField] = new Date().toISOString()
    }

    const { error: attributionError } = await (supabase.from('user_attribution' as never) as any)
      .upsert(
        userAttributionPayload,
        { onConflict: 'session_id' }
      )

    if (attributionError && !isMissingSchemaError(attributionError)) {
      console.error('user attribution upsert failed:', attributionError)
    }

    if (userId && cohortField) {
      const { error: cohortError } = await (supabase.from('users' as never) as any)
        .update({
          analytics_excluded: isInternalAnalyticsEmail(email),
          [cohortField]: new Date().toISOString(),
        })
        .eq('id', userId)
        .is(cohortField, null)

      if (cohortError && !isMissingSchemaError(cohortError)) {
        console.error('user cohort update failed:', cohortError)
      }
    }

    if (searchId && (event === 'search_performed' || event === 'first_search_performed')) {
      const searchPayload = {
        id: searchId,
        user_id: userId,
        session_id: sessionId,
        email,
        search_query: normalizeOptionalText(body.search_query) || normalizeOptionalText(body.query),
        business_type: normalizeOptionalText(body.business_type),
        location: normalizeOptionalText(body.location),
        filters_used: cleanMetadata(body.filters_used) || cleanMetadata(body.metadata),
        number_of_results_returned:
          normalizeInteger(body.number_of_results_returned) || normalizeInteger(body.leads_count),
        number_of_results_with_email: normalizeInteger(body.number_of_results_with_email),
        number_of_results_with_phone: normalizeInteger(body.number_of_results_with_phone),
        number_of_results_with_website: normalizeInteger(body.number_of_results_with_website),
        search_duration_ms: normalizeOptionalInteger(body.search_duration_ms),
        error_message: normalizeOptionalText(body.error_message),
        no_results: Boolean(body.no_results),
        source_page: normalizeOptionalText(body.source_page),
        ...attributionPayload,
        updated_at: new Date().toISOString(),
      }

      const { error: searchError } = await (supabase.from('search_analytics' as never) as any)
        .upsert(searchPayload, { onConflict: 'id' })

      if (searchError && !isMissingSchemaError(searchError)) {
        console.error('search analytics upsert failed:', searchError)
      }
    }

    if (searchId) {
      const flag = getPostSearchFlag(event)
      if (flag) {
        const { error: flagError } = await (supabase.from('search_analytics' as never) as any)
          .update({ [flag]: true, updated_at: new Date().toISOString() })
          .eq('id', searchId)

        if (flagError && !isMissingSchemaError(flagError)) {
          console.error('search analytics flag update failed:', flagError)
        }
      }

      if (event === 'search_performed' || event === 'first_search_performed') {
        const { data: previousSearch, error: previousSearchError } = await (supabase
          .from('search_analytics' as never) as any)
          .select('id')
          .neq('id', searchId)
          .or([userId ? `user_id.eq.${userId}` : null, `session_id.eq.${sessionId}`].filter(Boolean).join(','))
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!previousSearchError && previousSearch?.id) {
          const { error: previousFlagError } = await (supabase.from('search_analytics' as never) as any)
            .update({ performed_another_search: true, updated_at: new Date().toISOString() })
            .eq('id', previousSearch.id)

          if (previousFlagError && !isMissingSchemaError(previousFlagError)) {
            console.error('previous search flag update failed:', previousFlagError)
          }
        }
      }
    }

    if ((email || user?.id) && sessionId) {
      const updatePayload: { email?: string; user_id?: string } = {}
      if (email) updatePayload.email = email
      if (user?.id) updatePayload.user_id = user.id

      const { error: updateError } = await supabase
        .from('activity_logs')
        .update(updatePayload)
        .eq('session_id', sessionId)
        .or([email ? 'email.is.null' : null, user?.id ? 'user_id.is.null' : null].filter(Boolean).join(','))

      if (updateError) {
        console.error('activity tracking backfill failed:', updateError)
      }
    }
  } catch (error) {
    console.error('activity tracking failed:', error)
  }

  return Response.json({ success: true })
}
