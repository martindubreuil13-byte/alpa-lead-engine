import { NextResponse } from 'next/server'

import { openai } from '@/lib/ai/openai'
import {
  estimateLightProfileCost,
  generateLightProfile,
  LIGHT_PROFILE_LIMITS,
  LIGHT_PROFILE_MODEL,
  readStoredLightProfile,
  hasEnoughEvidence,
} from '@/lib/guest/light-profile'
import { sameOrigin } from '@/lib/guest/security'
import { guestDb, guestSession, loadGuestSession } from '@/lib/guest/server'
import type { TrialLead } from '@/lib/trial'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const NO_STORE = { 'Cache-Control': 'no-store' }

// A short profile for one business of the visitor's own free trial, written when they open it. The signed trial cookie decides
// whose trial this is; the request names only a business id, which must be one of that trial's own businesses. The website text
// comes from the stored trial (never from the request) and nothing is fetched. Every limit is enforced here and in the database:
// the feature switch, one generation at a time per business, 25 profiles and 40 attempts per trial, a shared daily ceiling, and
// a cap on generations running at once on this server.

const MAX_CONCURRENT = 6
let running = 0

const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

function dailyCeiling() {
  const configured = Number(process.env.GUEST_PROFILES_DAILY_LIMIT)
  return Number.isInteger(configured) && configured >= 1 && configured <= 5000 ? configured : LIGHT_PROFILE_LIMITS.dailyCeiling
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return reply({ error: 'Request origin refused' }, 403)
  const body = await req.json().catch(() => null)
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : ''
  if (!leadId || leadId.length > 100) return reply({ error: 'Choose a business to profile.', code: 'invalid' }, 400)

  try {
    // Only the signed cookie identifies a trial; this never creates one.
    const trialId = await guestSession()
    if (!trialId) return reply({ error: 'Start a free search first.', code: 'no_trial' }, 401)
    let trial: Awaited<ReturnType<typeof loadGuestSession>>
    try {
      trial = await loadGuestSession(trialId)
    } catch {
      return reply({ error: 'This trial has expired.', code: 'expired' }, 410)
    }

    const lead = (Array.isArray(trial.leads) ? (trial.leads as TrialLead[]) : []).find((entry) => entry?.id === leadId)
    if (!lead) return reply({ error: 'That business is not part of your trial.', code: 'not_found' }, 404)

    const cached = readStoredLightProfile(lead.light_profile)
    if (cached) return reply({ profile: cached, cached: true })

    // Too little stored website text: say so without spending anything or using an attempt.
    if (!hasEnoughEvidence(lead.website_intelligence)) return reply({ code: 'insufficient' }, 422)

    if (process.env.GUEST_PROFILES_ENABLED !== 'true' || !process.env.OPENAI_API_KEY) return reply({ error: 'Profiles are not available right now.', code: 'unavailable' }, 503)
    // The slot is taken before any await, so simultaneous requests cannot all pass the check.
    if (running >= MAX_CONCURRENT) return reply({ error: 'Busy right now. Please try again in a moment.', code: 'busy' }, 503)
    running += 1
    try {
      const run = crypto.randomUUID()
      const { data: claim, error: claimError } = await guestDb().rpc('begin_guest_profile', {
        p_id: trialId,
        p_lead: leadId,
        p_run: run,
        p_max: LIGHT_PROFILE_LIMITS.maxProfilesPerTrial,
        p_max_attempts: LIGHT_PROFILE_LIMITS.maxAttemptsPerTrial,
        p_daily_max: dailyCeiling(),
      })
      if (claimError) return reply({ error: 'Profiles are not available right now.', code: 'unavailable' }, 503)
      if (claim === 'busy') return reply({ code: 'busy' }, 409)
      if (claim === 'limit') return reply({ error: 'Your free trial has used its profiles.', code: 'limit' }, 429)
      if (claim === 'budget') return reply({ error: 'Profiles are paused for today. Please try again tomorrow.', code: 'budget' }, 429)
      if (claim === 'cached') {
        const again = await loadGuestSession(trialId)
        const stored = readStoredLightProfile((again.leads as TrialLead[]).find((entry) => entry?.id === leadId)?.light_profile)
        return stored ? reply({ profile: stored, cached: true }) : reply({ code: 'busy' }, 409)
      }
      if (claim === 'not_found') return reply({ error: 'That business is not part of your trial.', code: 'not_found' }, 404)
      if (claim !== 'claimed') return reply({ error: 'This trial has expired.', code: 'expired' }, 410)

      const result = await generateLightProfile({ companyName: lead.company_name, facts: lead.website_intelligence }, async (prompt) => {
        const completion = await openai.chat.completions.create(
          {
            model: LIGHT_PROFILE_MODEL,
            messages: [
              { role: 'system', content: 'You write short factual business profiles using only the supplied website text. Never speculate or fill gaps. Return valid JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_tokens: LIGHT_PROFILE_LIMITS.maxOutputTokens,
            response_format: { type: 'json_object' },
          },
          { timeout: LIGHT_PROFILE_LIMITS.timeoutMs, maxRetries: 0 }
        )
        return {
          content: completion.choices[0]?.message?.content || '',
          inputTokens: completion.usage?.prompt_tokens || 0,
          outputTokens: completion.usage?.completion_tokens || 0,
        }
      })
      console.info('[guest-profile]', JSON.stringify({ ok: result.ok, reason: result.ok ? null : result.reason, cost: Number(estimateLightProfileCost(result.inputTokens, result.outputTokens).toFixed(6)) }))

      if (!result.ok) {
        await guestDb().rpc('release_guest_profile', { p_id: trialId, p_lead: leadId, p_run: run })
        return reply({ error: "A summary couldn't be written for this business just now.", code: result.reason }, result.reason === 'insufficient' ? 422 : 502)
      }
      const { data: saved, error: saveError } = await guestDb().rpc('finish_guest_profile', {
        p_id: trialId,
        p_lead: leadId,
        p_run: run,
        p_profile: result.profile,
        p_max: LIGHT_PROFILE_LIMITS.maxProfilesPerTrial,
      })
      if (saveError || !saved) return reply({ error: "A summary couldn't be saved just now.", code: 'failed' }, 502)
      return reply({ profile: result.profile, cached: false })
    } finally {
      running -= 1
    }
  } catch {
    return reply({ error: "A summary couldn't be written just now.", code: 'failed' }, 503)
  }
}
