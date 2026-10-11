// Local-only replay scenarios for reviewing the Discover experience without a real search.
//
// IMPORTANT: these are simulations. The *shape* of the event sequence follows a real search
// (a burst of discovered businesses, a planned number of website checks that complete one by
// one, a contact-ready count, then saving and the result) but every timestamp is ILLUSTRATIVE.
// Business names are fictional. The replay never calls an API and writes nothing.

import type { ScrapeProgressEvent } from './progress-events.ts'
import type { TrialLead } from '../trial.ts'

export type ReplayEvent = { at: number } & (
  | { kind: 'log'; message: string }
  | { kind: 'progress'; event: ScrapeProgressEvent }
  | { kind: 'result'; addedCount: number }
)

export type ReplayScenario = {
  id: string
  label: string
  description: string
  query: string
  location: string
  requested: number
  /** Always true: replay timings are never measured. */
  illustrativeTiming: true
  events: ReplayEvent[]
  /** Fictional businesses shown in the results once the replay finishes. */
  leads: TrialLead[]
  /** Time of the final event. */
  durationMs: number
}

const BUSINESSES = [
  'Harbor Dental Studio',
  'Brickell Smile Clinic',
  'Coral Way Dentistry',
  'Bayfront Family Dental',
  'Palm Grove Orthodontics',
  'Little Havana Dental Care',
  'Sunset Pointe Dentistry',
  'Wynwood Dental Arts',
  'Coconut Creek Smiles',
  'Gables Dental Group',
]

function fixtureLead(index: number, fields: Partial<TrialLead>): TrialLead {
  return {
    id: `replay-${index + 1}`,
    company_name: BUSINESSES[index],
    city: 'Miami',
    industry: 'Dentists',
    email: null,
    email_source: null,
    email_confidence: null,
    is_generic_email: false,
    phone: null,
    website: null,
    status: 'new',
    pipeline_stage: null,
    close_reason: null,
    source: 'replay',
    cost_estimate: null,
    created_at: new Date(0).toISOString(),
    commercial_profile: null,
    ci_enrichment_status: null,
    ...fields,
  }
}

// Nine of the ten businesses reach the results (the tenth had no usable contact details). Illustrative mix:
// seven websites, three email addresses of which one is only a possible match, eight phone numbers, and one
// business that already has a stored Business Profile so the synopsis line can be reviewed.
export const REPLAY_LEADS: TrialLead[] = [
  fixtureLead(0, {
    website: 'https://www.harbordental.example',
    email: 'hello@harbordental.example',
    email_confidence: 'high',
    phone: '(305) 555-0142',
    commercial_profile: {
      summary:
        'General and cosmetic dental practice in Miami offering routine care, whitening and Invisalign, with evening appointments on weekdays.',
    },
    ci_enrichment_status: 'completed',
  }),
  // Illustrative inspection states, so each wording can be reviewed: read fully, none found.
  fixtureLead(1, { website: 'https://brickellsmile.example', phone: '(305) 555-0177', email_inspection: { state: 'checked', partial: false } }),
  // an address found while only part of the site could be checked
  fixtureLead(2, { website: 'https://coralwaydentistry.example', email: 'office@coralwaydentistry.example', email_confidence: 'medium', phone: '(305) 555-0119', email_inspection: { state: 'checked', partial: true } }),
  // could not be read at all
  fixtureLead(3, { website: 'https://bayfrontfamilydental.example', phone: '(305) 555-0163', email_inspection: { state: 'unreadable', partial: false } }),
  // only part of the site could be checked, nothing found
  fixtureLead(4, { website: 'https://palmgroveortho.example', phone: '(305) 555-0108', email_inspection: { state: 'checked', partial: true } }),
  fixtureLead(5, { phone: '(786) 555-0134' }),
  fixtureLead(6, { website: 'https://sunsetpointedentistry.example', email: 'frontdesk@sunsetpointe.example', email_confidence: 'low', phone: '(786) 555-0190' }),
  fixtureLead(7, { website: 'https://wynwooddentalarts.example', phone: '(305) 555-0121' }),
  fixtureLead(8, { website: 'https://coconutcreeksmiles.example' }),
]

// Eight of ten businesses have a website to check; three of those produce an email.
const CHECK_COMPLETIONS = [
  { at: 7600, email: true },
  { at: 8900, email: false },
  { at: 9700, email: true },
  { at: 11200, email: false },
  { at: 12600, email: false },
  { at: 13300, email: true },
  { at: 15100, email: false },
  { at: 16400, email: false },
]

function buildStandardEvents(): ReplayEvent[] {
  const events: ReplayEvent[] = []
  const log = (at: number, message: string) => events.push({ at, kind: 'log', message })
  const progress = (at: number, event: ScrapeProgressEvent) => events.push({ at, kind: 'progress', event })

  log(350, '🚀 starting scraper')
  log(400, 'Finding businesses')
  log(1100, '🔎 dentists in Miami')
  log(1300, '🛰️ Serper priority pass')

  // Discovery arrives as a single burst, exactly like the real stream.
  BUSINESSES.forEach((name, index) => log(6200 + index * 4, `📥 ${name}`))
  log(6260, '📦 discovered: 10')

  progress(6300, { type: 'progress', stage: 'checking', planned: 8, completed: 0, emailsFound: 0 })
  log(6320, 'Checking websites')
  log(6340, 'Extracting contacts')

  let emails = 0
  CHECK_COMPLETIONS.forEach((check, index) => {
    const name = BUSINESSES[index]
    log(check.at - 1500, `🔬 ${name}`)
    if (check.email) {
      emails += 1
      log(check.at, `✨ ${name}`)
    } else {
      log(check.at, `⛔ no email: ${name}`)
    }
    progress(check.at + 5, {
      type: 'progress',
      stage: 'checking',
      planned: 8,
      completed: index + 1,
      emailsFound: emails,
    })
  })

  log(16700, '📊 websites: 8, valid emails: 3, enrichment rate: 37.5%')
  log(16720, '📦 enriched: 9')

  progress(16800, { type: 'progress', stage: 'saving', considered: 9, processed: 0, saved: 0, duplicates: 0, invalid: 0, failed: 0 })
  for (let i = 1; i <= 9; i += 1) {
    progress(16800 + i * 190, {
      type: 'progress',
      stage: 'saving',
      considered: 9,
      processed: i,
      saved: i,
      duplicates: 0,
      invalid: 0,
      failed: 0,
    })
  }
  log(18700, '💾 saved: 9, duplicates: 0, invalid: 0, db errors: 0')
  log(18800, '🎉 Prospecting complete')
  events.push({ at: 18900, kind: 'result', addedCount: 9 })

  return events.sort((a, b) => a.at - b.at)
}

const STANDARD = buildStandardEvents()

/** The same run, but the connection is silent for 25 seconds after the search starts. */
function buildSlowEvents(): ReplayEvent[] {
  const SILENCE = 25_000
  return STANDARD.map((event) => (event.at > 1300 ? { ...event, at: event.at + SILENCE } : event))
}


// A production-shaped run for the clarity review: 25 requested, 25 found, a quiet improvement pass that
// evaluates two more candidates (27), 26 website checks, and exactly 25 businesses saved. Fictional names;
// illustrative timing; the event shapes are the ones the real stream sends.
const REFILL_PREFIX = ['Northbridge', 'Kensington', 'Thames', 'Marlowe', 'Hollis', 'Ashdown', 'Bellamy', 'Carrow', 'Dunmore', 'Everley', 'Fairholm', 'Gresham', 'Hartwell']
const REFILL_SUFFIX = ['Advisory', 'Consulting', 'Partners', 'Strategy', 'Associates']
const REFILL_NAMES = Array.from({ length: 27 }, (_, i) => `${REFILL_PREFIX[i % REFILL_PREFIX.length]} ${REFILL_SUFFIX[i % REFILL_SUFFIX.length]}`)

function buildRefillLeads(): TrialLead[] {
  return REFILL_NAMES.slice(0, 25).map((name, index) => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '')
    const hasWebsite = index !== 7
    const phone = `020 7946 ${String(1000 + index * 7).slice(-4)}`
    const base: TrialLead = {
      ...fixtureLead(0, {}),
      id: `replay-${index + 1}`,
      company_name: name,
      city: 'London',
      industry: 'Management consultant',
      phone,
      website: hasWebsite ? `https://www.${slug}.example` : null,
    }
    if (!hasWebsite) return base
    if (index % 3 === 0) return { ...base, email: `hello@${slug}.example`, email_confidence: 'high', email_inspection: { state: 'checked', partial: false } }
    if (index === 4) return { ...base, email: `info@${slug}.example`, email_confidence: 'low', email_inspection: { state: 'checked', partial: false } }
    if (index === 10) return { ...base, email: `office@${slug}.example`, email_confidence: 'medium', email_inspection: { state: 'checked', partial: true } }
    if (index === 13) return { ...base, email_inspection: { state: 'unreadable', partial: false } }
    if (index === 16) return { ...base, email_inspection: { state: 'checked', partial: true } }
    return { ...base, email_inspection: { state: 'checked', partial: false } }
  })
}

function buildRefillEvents(): ReplayEvent[] {
  const events: ReplayEvent[] = []
  const log = (at: number, message: string) => events.push({ at, kind: 'log', message })
  const checking = (at: number, planned: number, completed: number, emailsFound: number, possibleEmails: number, sequence: number) =>
    events.push({ at, kind: 'progress', event: { type: 'progress', stage: 'checking', planned, completed, emailsFound, possibleEmails, sequence } })

  log(300, '🚀 starting scraper')
  log(350, 'Finding businesses')
  log(900, '🔎 business consultants in London')
  REFILL_NAMES.slice(0, 18).forEach((name, i) => log(1500 + i * 60, `📥 ${name}`))
  REFILL_NAMES.slice(18, 25).forEach((name, i) => log(3000 + i * 60, `📥 ${name}`))
  log(3500, '📦 discovered: 25')
  checking(3550, 25, 0, 0, 0, 1)
  let sequence = 1
  for (let i = 1; i <= 24; i += 1) checking(3600 + i * 90, 25, i, Math.floor(i / 4), i > 5 ? 1 : 0, ++sequence)
  // the improvement pass evaluates two more candidates
  log(6000, 'Improving results')
  log(6100, '📥 ' + REFILL_NAMES[25])
  log(6120, '📥 ' + REFILL_NAMES[26])
  log(6200, '📦 discovered: 27')
  checking(6250, 27, 24, 6, 1, ++sequence)
  checking(6500, 27, 25, 7, 1, ++sequence)
  checking(6800, 27, 26, 7, 1, ++sequence)
  log(7000, '📦 enriched: 25')
  log(7100, '💾 saved: 25, duplicates: 0, invalid: 0, db errors: 0')
  log(7200, '🎉 Prospecting complete')
  events.push({ at: 7300, kind: 'result', addedCount: 25 })
  return events.sort((a, b) => a.at - b.at)
}

const REFILL = buildRefillEvents()
const REFILL_LEADS = buildRefillLeads()

const lastAt = (events: ReplayEvent[]) => events[events.length - 1]?.at ?? 0

export const REPLAY_SCENARIOS: ReplayScenario[] = [
  {
    id: 'standard',
    label: 'Standard run',
    description: '10 businesses requested, 8 websites checked, 3 emails found.',
    query: 'Dentists',
    location: 'Miami',
    requested: 10,
    illustrativeTiming: true,
    events: STANDARD,
    leads: REPLAY_LEADS,
    durationMs: lastAt(STANDARD),
  },
  {
    id: 'slow',
    label: 'Slow connection',
    description: 'Same run after 25 seconds of silence, to review the honest stall message.',
    query: 'Dentists',
    location: 'Miami',
    requested: 10,
    illustrativeTiming: true,
    events: buildSlowEvents(),
    leads: REPLAY_LEADS,
    durationMs: lastAt(buildSlowEvents()),
  },
  {
    id: 'refill',
    label: 'Improvement pass',
    description: '25 requested; 27 candidates evaluated, 26 website checks, 25 businesses saved.',
    query: 'Business consultants',
    location: 'London',
    requested: 25,
    illustrativeTiming: true,
    events: REFILL,
    leads: REFILL_LEADS,
    durationMs: lastAt(REFILL),
  },
]

export function getReplayScenario(id: string): ReplayScenario {
  return REPLAY_SCENARIOS.find((scenario) => scenario.id === id) ?? REPLAY_SCENARIOS[0]
}
