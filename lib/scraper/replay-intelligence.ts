// Local, development-only mock of the server's Business Intelligence progress response, for reviewing the third stage
// with fictional businesses. It builds the SAME response shape as /api/research/runs/{id} using the same pure functions
// (summarizeRun, describeIntelligence, buildProfileCard), so the real polling hook and the real components render it.
// Nothing here is imported by production code; it calls no network, database or AI.

import { buildProfileCard, describeIntelligence, summarizeRun, toProfileReason, type ProfileCard, type ProfileState, type RunProgressRow } from '../intelligence/run-progress.ts'
import type { TrialLead } from '../trial.ts'

export type ReplayIntelligenceMode = 'off' | 'disabled' | 'queued' | 'progress' | 'complete' | 'mixed' | 'live'
export const REPLAY_INTELLIGENCE_MODES: ReplayIntelligenceMode[] = ['off', 'disabled', 'queued', 'progress', 'live', 'complete', 'mixed']

const OFFERS = [
  ['Supply chain consulting', 'Process audits', 'Inventory planning'],
  ['Financial planning', 'Tax advisory'],
  ['Change management', 'Leadership coaching', 'Team workshops'],
  ['Market entry strategy', 'Competitive research'],
  ['Operational reviews', 'Cost reduction programmes'],
]
const AUDIENCES = ['Mid-size manufacturers', 'Owner-managed businesses', null, 'Healthcare providers', 'Professional services firms']

function profileFor(lead: TrialLead, index: number) {
  const offers = OFFERS[index % OFFERS.length]
  const audience = AUDIENCES[index % AUDIENCES.length]
  return {
    commercial_profile: {
      summary: `${lead.company_name} is a London consultancy that provides ${offers.join(', ').toLowerCase()} to its clients. Its website describes a small team working through structured reviews, written recommendations and follow-up sessions, and explains how an engagement is scoped and priced. The site lists its services and contact details but gives few client examples.`,
      primary_service: offers[0],
      core_services: offers,
      target_customer: audience ?? '',
      competitive_advantage: 'Unverified claim that is never displayed',
    },
    website_snapshot: {
      research_pages: [{ kind: 'homepage' }, { kind: 'services' }, ...(index % 3 === 0 ? [{ kind: 'about' }] : [])],
      source_urls: lead.website ? [lead.website, `${lead.website.replace(/\/$/, '')}/services`] : [],
    },
    business_signals: { has_pricing: index % 2 === 0, has_booking_link: index % 4 === 0, has_testimonials: index % 5 === 0, has_blog: false },
  }
}

export function buildReplayResearchResponse(leads: TrialLead[], mode: ReplayIntelligenceMode, poll = 0, now = Date.now()) {
  const states: ProfileState[] = leads.map((lead, index) => {
    if (!lead.website) return 'unavailable'
    switch (mode) {
      case 'disabled':
      case 'queued': return 'queued'
      case 'progress': return index < 12 ? 'ready' : index < 16 ? 'researching' : 'queued'
      case 'live': {
        const ready = Math.min(leads.length, poll * 5)
        return index < ready ? 'ready' : index < ready + 4 ? 'researching' : 'queued'
      }
      case 'complete': return 'ready'
      case 'mixed': return index === 13 ? 'failed' : index === 16 ? 'failed' : 'ready'
      default: return 'queued'
    }
  })
  const rows: RunProgressRow[] = leads.map((lead, index) => ({
    lead_id: lead.id,
    state: states[index],
    last_error: mode === 'mixed' && index === 16 ? 'run_budget_exhausted' : null,
    run_status: 'active',
    queued_at: new Date(now - 30_000).toISOString(),
  }))
  const summary = summarizeRun(rows, now)
  const running = mode !== 'disabled'
  const profiles: Record<string, ProfileCard> = {}
  leads.forEach((lead, index) => {
    if (states[index] !== 'ready') return
    const card = buildProfileCard(profileFor(lead, index))
    if (card) profiles[lead.id] = card
  })
  return {
    ok: true,
    runId: `replay-${mode}`,
    running,
    summary,
    stage: describeIntelligence(summary, running),
    rows: rows.map((row) => ({ leadId: row.lead_id, state: row.state, reason: toProfileReason(row.state, row.last_error) })),
    profiles,
  }
}
