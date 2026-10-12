// The My Leads list foundation: server-side search, filters, sorting and pagination, plus a separate on-demand dossier.
//
// Everything here runs with the signed-in customer's own session client. Row security restricts every read to the customer's
// own rows, and every query ALSO names the owner explicitly, so a mistake in either cannot expose another customer's lead.
// Nothing here uses a service-role client, and nothing reads without a page limit.
//
// The list asks the database for a handful of small columns only. The stored business profile, website snapshot and signals
// (kilobytes per lead) are never part of a list response; the card gets a short preview of the profile summary, and the full
// dossier is a separate request made when one business is opened.

import { buildProfileCard, deriveLeadProfileState, LEAD_PROFILE_LABEL, toProfileReason, type LeadProfileState, type ProfileCard, type ProfileReason } from '../intelligence/run-progress.ts'

type Client = any

export {
  BI_FILTERS, CONTACT_KEYS, MAX_OFFSET, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, SORT_KEYS, VIEWS,
  cleanSearchText, parseListParams,
  type BiFilter, type ContactKey, type ListParams, type ParseResult, type SortKey, type ViewKey,
} from './params.ts'
import { type BiFilter, type ContactKey, type ListParams, type SortKey } from './params.ts'

// ---------------------------------------------------------------------------------------------------------------------- query
/** The lightweight columns of a list response. No stored profile, snapshot or signals payload: only a preview of the summary. */
export const LIST_COLUMNS =
  'id, company_name, industry, city, email, phone, website, status, pipeline_stage, closed_at, created_at, last_activity_at, profile_summary:commercial_profile->>summary'

const ARCHIVED_STATUSES = ['closed_no_response', 'no_response', 'rejected', 'invalid', 'archived']
const QUEUE = 'commercial_intelligence_queue'
const NO_SUMMARY = 'commercial_profile->>summary.is.null,commercial_profile->>summary.eq.'

const SORTS: Record<SortKey, Array<{ column: string; ascending: boolean; nullsFirst?: boolean }>> = {
  activity: [{ column: 'last_activity_at', ascending: false, nullsFirst: false }, { column: 'created_at', ascending: false, nullsFirst: false }, { column: 'id', ascending: false }],
  newest: [{ column: 'created_at', ascending: false, nullsFirst: false }, { column: 'id', ascending: false }],
  oldest: [{ column: 'created_at', ascending: true, nullsFirst: false }, { column: 'id', ascending: true }],
  name: [{ column: 'company_name', ascending: true }, { column: 'id', ascending: true }],
  location: [{ column: 'city', ascending: true, nullsFirst: false }, { column: 'company_name', ascending: true }, { column: 'id', ascending: true }],
}

/** The same rule the My Leads page applies today: closed in the pipeline, or one of the archived statuses. */
export function isArchivedRow(row: { pipeline_stage?: string | null; status?: string | null }): boolean {
  const status = String(row.status ?? '').trim().toLowerCase()
  return row.pipeline_stage === 'closed' || ARCHIVED_STATUSES.includes(status)
}

function applyFilters(query: any, params: Pick<ListParams, 'view' | 'words' | 'city' | 'industry' | 'contact' | 'bi'>) {
  if (params.view === 'active') {
    query = query.or('pipeline_stage.is.null,pipeline_stage.neq.closed').or(`status.is.null,status.not.in.(${ARCHIVED_STATUSES.join(',')})`)
  } else if (params.view === 'archived') {
    query = query.or(`pipeline_stage.eq.closed,status.in.(${ARCHIVED_STATUSES.join(',')})`)
  }
  // Every word must match something; several words narrow the result, they never widen it.
  for (const word of params.words) {
    const like = `"*${word}*"`
    query = query.or(
      ['company_name', 'city', 'industry', 'website', 'commercial_profile->>summary', 'commercial_profile->>keywords', 'commercial_profile->>primary_service']
        .map((column) => `${column}.ilike.${like}`)
        .join(',')
    )
  }
  if (params.city) query = query.ilike('city', `%${params.city}%`)
  if (params.industry) query = query.ilike('industry', `%${params.industry}%`)
  for (const key of params.contact) query = query.not(key, 'is', null).neq(key, '')

  switch (params.bi) {
    case 'ready':
      query = query.not('commercial_profile->>summary', 'is', null).neq('commercial_profile->>summary', '')
      break
    case 'not_ready':
      query = query.or(NO_SUMMARY)
      break
    case 'awaiting':
      // No profile yet, and a research job of an authorized Discover run is queued or running.
      query = query.or(NO_SUMMARY).in(`${QUEUE}.status`, ['pending', 'processing']).not(`${QUEUE}.run_id`, 'is', null)
      break
    case 'attention':
      // No profile, and the run job ended without one (a customer-cancelled job is not an alert).
      query = query.or(NO_SUMMARY).eq(`${QUEUE}.status`, 'failed').not(`${QUEUE}.run_id`, 'is', null).not(`${QUEUE}.last_error`, 'ilike', 'cancelled%')
      break
  }
  return query
}

function selectFor(columns: string, bi: BiFilter | null | undefined) {
  // An inner join on the customer's own research jobs, only for the filters that depend on them.
  return bi === 'awaiting' || bi === 'attention' ? `${columns}, ${QUEUE}!inner(status)` : columns
}

// ---------------------------------------------------------------------------------------------------------------------- list
export type LeadListItem = {
  id: string
  company_name: string
  industry: string | null
  city: string | null
  email: string | null
  phone: string | null
  website: string | null
  has: { email: boolean; phone: boolean; website: boolean }
  archived: boolean
  created_at: string | null
  last_activity_at: string | null
  intelligence: { state: LeadProfileState; label: string; preview: string | null }
}

export type LeadSummary = { total: number; archived: number; ready: number; awaiting: number; attention: number }

export type LeadPage = {
  items: LeadListItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  summary?: LeadSummary
}

const present = (value: unknown) => typeof value === 'string' && value.trim() !== ''
const PREVIEW_LENGTH = 220

function preview(summary: unknown): string | null {
  if (!present(summary)) return null
  const text = String(summary).replace(/\s+/g, ' ').trim()
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : text
}

type JobRow = { lead_id: string; status: string; retry_count: number | null; last_error: string | null; run_id: string | null; created_at?: string }

async function runJobsFor(client: Client, userId: string, leadIds: string[]): Promise<Map<string, JobRow>> {
  const jobs = new Map<string, JobRow>()
  if (leadIds.length === 0) return jobs
  const { data, error } = await client
    .from(QUEUE)
    .select('lead_id, status, retry_count, last_error, run_id, created_at')
    .eq('user_id', userId)
    .not('run_id', 'is', null)
    .in('lead_id', leadIds)
    .order('created_at', { ascending: true })
  if (error) throw new Error('Research status could not be read')
  for (const job of (data ?? []) as JobRow[]) jobs.set(job.lead_id, job) // the newest run job wins
  return jobs
}

async function countWhere(client: Client, userId: string, filters: Parameters<typeof applyFilters>[1]): Promise<number> {
  const query = applyFilters(client.from('leads').select(selectFor('id', filters.bi), { count: 'exact', head: true }).eq('user_id', userId), filters)
  const { count, error } = await query
  if (error) throw new Error('Counts could not be read')
  return count ?? 0
}

export async function fetchLeadSummary(client: Client, userId: string): Promise<LeadSummary> {
  const none = { words: [], city: null, industry: null, contact: [] as ContactKey[] }
  const [total, archived, ready, awaiting, attention] = await Promise.all([
    countWhere(client, userId, { ...none, view: 'all', bi: null }),
    countWhere(client, userId, { ...none, view: 'archived', bi: null }),
    countWhere(client, userId, { ...none, view: 'active', bi: 'ready' }),
    countWhere(client, userId, { ...none, view: 'active', bi: 'awaiting' }),
    countWhere(client, userId, { ...none, view: 'active', bi: 'attention' }),
  ])
  return { total, archived, ready, awaiting, attention }
}

export async function fetchLeadPage(client: Client, userId: string, params: ListParams): Promise<LeadPage> {
  const from = (params.page - 1) * params.pageSize
  let query = applyFilters(client.from('leads').select(selectFor(LIST_COLUMNS, params.bi), { count: 'exact' }).eq('user_id', userId), params)
  for (const order of SORTS[params.sort]) query = query.order(order.column, order.nullsFirst === undefined ? { ascending: order.ascending } : { ascending: order.ascending, nullsFirst: order.nullsFirst })
  const { data, count, error } = await query.range(from, from + params.pageSize - 1)
  if (error) throw new Error('Leads could not be read')

  const rows = (data ?? []) as Array<Record<string, any>>
  const jobs = await runJobsFor(client, userId, rows.map((row) => row.id))
  const items: LeadListItem[] = rows.map((row) => {
    const state = deriveLeadProfileState({ commercial_profile: present(row.profile_summary) ? { summary: row.profile_summary } : null, website: row.website }, jobs.get(row.id))
    return {
      id: row.id,
      company_name: row.company_name,
      industry: row.industry ?? null,
      city: row.city ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      website: row.website ?? null,
      has: { email: present(row.email), phone: present(row.phone), website: present(row.website) },
      archived: isArchivedRow(row),
      created_at: row.created_at ?? null,
      last_activity_at: row.last_activity_at ?? row.created_at ?? null,
      intelligence: { state, label: LEAD_PROFILE_LABEL[state], preview: preview(row.profile_summary) },
    }
  })

  const total = count ?? 0
  const page: LeadPage = { items, total, page: params.page, pageSize: params.pageSize, hasMore: from + items.length < total }
  if (params.summary) page.summary = await fetchLeadSummary(client, userId)
  return page
}

// ------------------------------------------------------------------------------------------------------------------ dossier
const DOSSIER_COLUMNS =
  'id, company_name, industry, city, email, phone, website, contact_name, notes, status, pipeline_stage, closed_at, created_at, last_activity_at, source, source_url, email_source, email_confidence, is_generic_email, ci_completed_at, commercial_profile, website_snapshot, business_signals'

export type LeadDossier = {
  id: string
  company_name: string
  industry: string | null
  city: string | null
  archived: boolean
  status: string | null
  pipeline_stage: string | null
  notes: string | null
  created_at: string | null
  last_activity_at: string | null
  source: string | null
  contact: {
    name: string | null
    email: string | null
    email_source: string | null
    email_confidence: string | null
    is_generic_email: boolean
    phone: string | null
    website: string | null
    source_url: string | null
  }
  intelligence: {
    state: LeadProfileState
    label: string
    reason: ProfileReason
    researched_at: string | null
    /** The reader-facing profile (what the website says, kept apart from what the AI wrote); null until one exists. */
    card: ProfileCard | null
    /** Structured fields of the stored profile, only those present. */
    profile: { industry: string | null; business_category: string | null; primary_service: string | null; core_services: string[]; target_customer: string | null; keywords: string[] } | null
  }
}

const text = (value: unknown, max = 200): string | null => (present(value) ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : null)
const list = (value: unknown, max: number): string[] => (Array.isArray(value) ? value.map((item) => text(item, 120)).filter((item): item is string => item !== null).slice(0, max) : [])

/** One business, in full, only for its owner. Returns null for a missing id and for someone else's id alike. */
export async function fetchLeadDossier(client: Client, userId: string, id: string): Promise<LeadDossier | null> {
  const { data: row, error } = await client.from('leads').select(DOSSIER_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) throw new Error('Lead could not be read')
  if (!row) return null

  const job = (await runJobsFor(client, userId, [row.id])).get(row.id)
  const state = deriveLeadProfileState(row, job)
  const card = buildProfileCard(row)
  const stored = row.commercial_profile && typeof row.commercial_profile === 'object' && !Array.isArray(row.commercial_profile) ? row.commercial_profile : null
  return {
    id: row.id,
    company_name: row.company_name,
    industry: row.industry ?? null,
    city: row.city ?? null,
    archived: isArchivedRow(row),
    status: row.status ?? null,
    pipeline_stage: row.pipeline_stage ?? null,
    notes: text(row.notes, 4000),
    created_at: row.created_at ?? null,
    last_activity_at: row.last_activity_at ?? row.created_at ?? null,
    source: row.source ?? null,
    contact: {
      name: text(row.contact_name),
      email: row.email ?? null,
      email_source: text(row.email_source, 300),
      email_confidence: text(row.email_confidence, 20),
      is_generic_email: row.is_generic_email === true,
      phone: row.phone ?? null,
      website: row.website ?? null,
      source_url: text(row.source_url, 500),
    },
    intelligence: {
      state,
      label: LEAD_PROFILE_LABEL[state],
      reason: state === 'not_started' ? null : toProfileReason(state, job?.last_error),
      researched_at: row.ci_completed_at ?? null,
      card,
      profile: stored && card
        ? {
            industry: text(stored.industry),
            business_category: text(stored.business_category),
            primary_service: text(stored.primary_service),
            core_services: list(stored.core_services, 8),
            target_customer: text(stored.target_customer),
            keywords: list(stored.keywords, 12),
          }
        : null,
    },
  }
}

// ------------------------------------------------------------------------------------------------------------------ export
/** Most businesses one CSV export may carry, and how many ids one database read names (URL length). */
export const EXPORT_MAX = 500
const EXPORT_CHUNK = 100
const EXPORT_COLUMNS = 'id, company_name, email, phone, website, city, commercial_profile, ci_completed_at'

export type ExportLead = {
  id: string
  company_name: string
  email: string | null
  phone: string | null
  website: string | null
  city: string | null
  commercial_profile: unknown
  ci_completed_at: string | null
}

/**
 * The rows of a CSV export for the ids the customer selected. Only their own businesses can be returned: an id that is not
 * theirs is simply absent. Read in fixed chunks, so no request names an unbounded list.
 */
export async function fetchLeadsForExport(client: Client, userId: string, ids: string[]): Promise<ExportLead[]> {
  const unique = [...new Set(ids)].slice(0, EXPORT_MAX)
  const found = new Map<string, ExportLead>()
  for (let i = 0; i < unique.length; i += EXPORT_CHUNK) {
    const { data, error } = await client.from('leads').select(EXPORT_COLUMNS).eq('user_id', userId).in('id', unique.slice(i, i + EXPORT_CHUNK))
    if (error) throw new Error('Leads could not be read')
    for (const row of (data ?? []) as ExportLead[]) found.set(row.id, row)
  }
  return unique.map((id) => found.get(id)).filter((row): row is ExportLead => Boolean(row))
}
