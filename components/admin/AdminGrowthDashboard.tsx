'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { LeadFollowUpRow } from '@/lib/admin/lead-follow-ups'
import type { Database } from '@/lib/supabase/types'

type ActivityLogRow = Database['public']['Tables']['activity_logs']['Row']
type SearchAnalyticsRow = Database['public']['Tables']['search_analytics']['Row'] & {
  started_checkout_after_search?: boolean
  paid_after_search?: boolean
}
type AttributionRow = Database['public']['Tables']['user_attribution']['Row']
type UserRow = Pick<
  Database['public']['Tables']['users']['Row'],
  | 'id'
  | 'email'
  | 'plan'
  | 'role'
  | 'created_at'
  | 'subscription_status'
  | 'plan_status'
  | 'subscription_tier'
  | 'subscription_active'
  | 'analytics_excluded'
  | 'signup_date'
  | 'first_search_date'
  | 'first_export_date'
  | 'first_upgrade_click_date'
  | 'paid_conversion_date'
>

type DateRange = 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'custom'
type ExportFilter = 'any' | 'csv' | 'email' | 'none' | ''
type UpgradeFunnelFilter = 'viewed_pricing' | 'clicked_upgrade' | 'started_checkout' | 'paid' | ''
type SearchMatchMode = 'contains' | 'exact'
type SourceFilter = 'linkedin' | 'cold_email' | 'facebook' | 'tiktok' | 'direct' | 'referral' | 'unknown' | ''
type SectionKey = 'summary' | 'leaks' | 'users' | 'search' | 'searchRows' | 'source'
type SortKey = 'trials' | 'activated' | 'paid'

type UserSummary = {
  user: UserRow
  identity: string
  source: string
  device: string
  trialStatus: string
  searches: number
  csvDownloads: number
  emailExports: number
  activationScore: number
  activationSegment: string
  lastActive: string | null
  viewedPricing: boolean
  upgradeClicked: boolean
  startedCheckout: boolean
  paid: boolean
  sessionIds: string[]
  searchQueries: string[]
}

type SourcePerformanceRow = {
  source: string
  visits: number
  trials: number
  activated: number
  exports: number
  pricingViews: number
  upgradeClicks: number
  paidUsers: number
}

type SearchValueRow = {
  query: string
  searchCount: number
  exportRate: string
  pricingViewRate: string
  upgradeRate: string
  exportRateValue: number
}

type GrowthReport = {
  generated_at: string
  date_range: {
    label: string
    start: string
    end: string
  }
  funnel_summary: Record<string, number>
  conversion_rates: Record<string, string>
  acquisition_breakdown: Array<Record<string, string | number>>
  source_performance: Array<Record<string, string | number>>
  search_intelligence: Array<Record<string, string | number>>
  search_value_analytics: Array<Record<string, string | number>>
  user_activity: Array<Record<string, string | number | boolean>>
  activation_metrics: {
    activated_users: number
    average_activation_score: number
    users_returning_after_24_hours: number
    most_engaged_users: Array<Record<string, string | number | boolean>>
  }
  conversion_leaks: Record<string, Array<Record<string, string | number | boolean>>>
  daily_metrics: Array<Record<string, string | number>>
  top_searches: Array<Record<string, string | number>>
  worst_searches: Array<Record<string, string | number>>
  upgrade_funnel: Record<string, number | string>
  paid_conversion_summary: Record<string, number | string>
}

const RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'custom', label: 'Custom Range' },
]

const ACTIVATION_FILTERS = [
  'Not Activated',
  'Lightly Activated',
  'Activated',
  'High Intent',
  'Paid',
]

const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: '', label: 'All Sources' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'cold_email', label: 'Cold Email' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'direct', label: 'Direct' },
  { value: 'referral', label: 'Referral' },
  { value: 'unknown', label: 'Unknown' },
]

const PAGE_SIZE = 25
const SECTION_STORAGE_KEY = 'alpa_admin_analytics_sections'
const DEFAULT_SECTIONS_OPEN: Record<SectionKey, boolean> = {
  summary: true,
  leaks: false,
  users: false,
  search: false,
  searchRows: false,
  source: false,
}

function paginate<T>(rows: T[], page: number) {
  const safePage = Math.max(0, page)
  return rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
}

function getTodayDateInput() {
  return new Date().toISOString().slice(0, 10)
}

function getRangeBounds(range: DateRange, startDate: string, endDate: string) {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()

  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
    return { start, end }
  }

  if (range === 'yesterday') {
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    end.setDate(end.getDate() - 1)
    return { start, end }
  }

  if (range === 'custom') {
    return {
      start: startDate ? new Date(`${startDate}T00:00:00`) : new Date(0),
      end: endDate ? new Date(`${endDate}T23:59:59.999`) : end,
    }
  }

  start.setDate(start.getDate() - (range === '7d' ? 7 : range === '14d' ? 14 : 30))
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function getRangeLabel(range: DateRange, startDate: string, endDate: string) {
  if (range === 'custom') return `${startDate || 'Beginning'} to ${endDate || 'Today'}`
  return RANGE_OPTIONS.find((option) => option.value === range)?.label || range
}

function inRange(value: string | null | undefined, start: Date, end: Date) {
  if (!value) return false
  const time = new Date(value).getTime()
  return time >= start.getTime() && time <= end.getTime()
}

function normalizeEmail(value: string | null | undefined) {
  const trimmed = String(value || '').trim().toLowerCase()
  return trimmed || null
}

function normalizeText(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

function parseExclusionList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function isExcludedEmail(email: string | null | undefined, exclusions: string[]) {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return exclusions.some((entry) => {
    const domain = normalized.split('@')[1] || ''
    return normalized === entry || domain === entry.replace(/^@/, '') || normalized.endsWith(`@${entry.replace(/^@/, '')}`)
  })
}

function isInternalEmail(email: string | null | undefined) {
  const domain = normalizeEmail(email)?.split('@')[1] || ''
  return domain === 'mindrasolutions.com' || domain.endsWith('.mindrasolutions.com')
}

function isInternalSummary(summary: UserSummary, exclusions: string[]) {
  return (
    Boolean(summary.user.analytics_excluded) ||
    summary.user.role === 'admin' ||
    summary.user.plan === 'admin' ||
    isInternalEmail(summary.user.email) ||
    isExcludedEmail(summary.user.email, exclusions)
  )
}

function isInternalLog(log: ActivityLogRow, excludedIdentities: Set<string>, exclusions: string[]) {
  return (
    excludedIdentities.has(getActorIdentity(log)) ||
    isInternalEmail(log.email) ||
    isExcludedEmail(log.email, exclusions)
  )
}

function isInternalSearch(search: SearchAnalyticsRow, excludedIdentities: Set<string>, exclusions: string[]) {
  return (
    excludedIdentities.has(getActorIdentity(search)) ||
    isInternalEmail(search.email) ||
    isExcludedEmail(search.email, exclusions)
  )
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 100)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function isPaidUser(user: UserRow) {
  if (user.plan === 'admin') return false
  if (user.subscription_active) return true
  if (['prospector', 'starter', 'pro'].includes(user.plan || '')) return true
  return ['active', 'trialing'].includes(user.plan_status || user.subscription_status || '')
}

function getSource(attribution?: AttributionRow | null) {
  return attribution?.utm_source || attribution?.referrer || 'direct'
}

function getEventSource(row: {
  utm_source?: string | null
  referrer?: string | null
  session_id?: string | null
  user_id?: string | null
  email?: string | null
}, attribution: AttributionRow[]) {
  if (row.utm_source || row.referrer) return row.utm_source || row.referrer || 'direct'
  return getSource(
    attribution.find(
      (entry) =>
        entry.user_id === row.user_id ||
        entry.session_id === row.session_id ||
        normalizeEmail(entry.email) === normalizeEmail(row.email)
    )
  )
}

function classifySource(source: string | null | undefined): SourceFilter {
  const value = normalizeText(source)
  if (!value || value === 'unknown') return 'unknown'
  if (value === 'direct' || value === '(direct)' || value.includes('direct')) return 'direct'
  if (value.includes('linkedin')) return 'linkedin'
  if (value.includes('cold') || value.includes('email') || value.includes('outreach')) return 'cold_email'
  if (value.includes('facebook') || value.includes('fb.')) return 'facebook'
  if (value.includes('tiktok')) return 'tiktok'
  if (value.includes('referral') || value.startsWith('http') || value.includes('.')) return 'referral'
  return 'unknown'
}

function getIdentity(row: { user_id?: string | null; email?: string | null; session_id?: string | null }) {
  return row.user_id || normalizeEmail(row.email) || row.session_id || null
}

function getActorIdentity(row: { user_id?: string | null; email?: string | null; session_id?: string | null }) {
  return getIdentity(row) || 'unknown'
}

function getSearchQuery(search: SearchAnalyticsRow) {
  return search.search_query || search.business_type || ''
}

function getActivationSegment(score: number, paid: boolean) {
  if (paid) return 'Paid'
  if (score >= 7) return 'High Intent'
  if (score >= 4) return 'Activated'
  if (score >= 1) return 'Lightly Activated'
  return 'Not Activated'
}

function scoreUser(params: {
  logs: ActivityLogRow[]
  searches: SearchAnalyticsRow[]
  paid: boolean
}) {
  const events = new Set(params.logs.map((log) => log.event))
  const hasReturnedAfter24h =
    params.logs.length > 1 &&
    new Date(params.logs[0].created_at).getTime() - new Date(params.logs[params.logs.length - 1].created_at).getTime() >=
      24 * 60 * 60 * 1000

  return (
    (params.searches.length > 0 || events.has('first_search_performed') || events.has('search_performed') ? 1 : 0) +
    (events.has('results_viewed') || params.searches.some((search) => search.viewed_results) ? 1 : 0) +
    (events.has('lead_detail_viewed') || params.searches.some((search) => search.opened_lead_detail) ? 1 : 0) +
    (events.has('csv_downloaded') || params.searches.some((search) => search.downloaded_csv_after_search) ? 2 : 0) +
    (events.has('email_exported') || events.has('email_export_sent') || params.searches.some((search) => search.email_exported_after_search) ? 3 : 0) +
    (hasReturnedAfter24h ? 2 : 0) +
    (events.has('upgrade_clicked') || params.searches.some((search) => search.clicked_upgrade_after_search) ? 3 : 0) +
    (params.paid ? 5 : 0)
  )
}

function createSyntheticUser(identity: string, logs: ActivityLogRow[], searches: SearchAnalyticsRow[]): UserRow {
  const email =
    normalizeEmail(logs.find((log) => log.email)?.email) ||
    normalizeEmail(searches.find((search) => search.email)?.email) ||
    (identity.includes('@') ? identity : `Session ${identity.slice(0, 8)}`)
  const createdAt =
    [...logs.map((log) => log.created_at), ...searches.map((search) => search.created_at)]
      .filter(Boolean)
      .sort()[0] || new Date().toISOString()

  return {
    id: identity,
    email,
    role: 'user',
    plan: 'free',
    created_at: createdAt,
    subscription_status: null,
    plan_status: null,
    subscription_tier: null,
    subscription_active: false,
    analytics_excluded: false,
    signup_date: createdAt,
    first_search_date: searches[0]?.created_at || null,
    first_export_date: null,
    first_upgrade_click_date: null,
    paid_conversion_date: null,
  }
}

function emptySearchFromLog(log: ActivityLogRow): SearchAnalyticsRow {
  return {
    id: log.search_id || log.id,
    user_id: log.user_id,
    session_id: log.session_id,
    email: log.email,
    search_query: log.query,
    business_type: log.query,
    location: log.location,
    filters_used: log.metadata,
    number_of_results_returned: log.leads_count || 0,
    number_of_results_with_email: 0,
    number_of_results_with_phone: 0,
    number_of_results_with_website: 0,
    search_duration_ms: null,
    error_message: null,
    no_results: (log.leads_count || 0) === 0,
    device_type: log.device_type,
    browser: log.browser,
    operating_system: log.operating_system,
    source_page: log.source_page,
    utm_source: log.utm_source,
    utm_medium: log.utm_medium,
    utm_campaign: log.utm_campaign,
    utm_content: log.utm_content,
    utm_term: log.utm_term,
    referrer: log.referrer,
    first_landing_page: log.first_landing_page,
    viewed_results: true,
    opened_lead_detail: false,
    downloaded_csv_after_search: false,
    email_exported_after_search: false,
    performed_another_search: false,
    viewed_pricing_after_search: false,
    clicked_upgrade_after_search: false,
    started_checkout_after_search: false,
    paid_after_search: false,
    created_at: log.created_at,
    updated_at: log.created_at,
  }
}

function findRelatedSearch(searches: SearchAnalyticsRow[], log: ActivityLogRow) {
  const logTime = new Date(log.created_at).getTime()
  return searches
    .filter((search) => {
      const searchTime = new Date(search.created_at).getTime()
      if (searchTime > logTime) return false
      const sameSearchId = Boolean(log.search_id && search.id === log.search_id)
      const sameSession = Boolean(log.session_id && search.session_id === log.session_id)
      const sameUser = Boolean(log.user_id && search.user_id === log.user_id)
      const sameEmail = Boolean(normalizeEmail(log.email) && normalizeEmail(search.email) === normalizeEmail(log.email))
      return sameSearchId || sameSession || sameUser || sameEmail
    })
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0]
}

function buildEffectiveSearches(searches: SearchAnalyticsRow[], logs: ActivityLogRow[]) {
  const hasSearchRows = searches.length > 0
  const baseSearches = hasSearchRows
    ? searches.map((search) => ({ ...search }))
    : logs
        .filter((log) => log.event === 'scrape_completed' && log.query)
        .map(emptySearchFromLog)

  const seenSearchesByIdentity = new Map<string, SearchAnalyticsRow>()
  for (const search of baseSearches.slice().sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))) {
    const identity = getActorIdentity(search)
    const previous = seenSearchesByIdentity.get(identity)
    if (previous) previous.performed_another_search = true
    seenSearchesByIdentity.set(identity, search)
  }

  for (const log of logs) {
    const related = findRelatedSearch(baseSearches, log)
    if (!related) continue

    if (log.event === 'csv_downloaded') related.downloaded_csv_after_search = true
    if (log.event === 'email_exported' || log.event === 'email_export_sent') related.email_exported_after_search = true
    if (log.event === 'plans_viewed' || log.event === 'pricing_page_viewed') related.viewed_pricing_after_search = true
    if (log.event === 'upgrade_clicked') related.clicked_upgrade_after_search = true
    if (log.event === 'checkout_started') related.started_checkout_after_search = true
    if (log.event === 'checkout_completed' || log.event === 'payment_completed') related.paid_after_search = true
    if (log.event === 'lead_detail_viewed') related.opened_lead_detail = true
    if (log.event === 'results_viewed' || log.event === 'scrape_completed') related.viewed_results = true
  }

  return baseSearches
}

function buildUserSummaries(
  users: UserRow[],
  logs: ActivityLogRow[],
  searches: SearchAnalyticsRow[],
  attribution: AttributionRow[]
) {
  const logsByIdentity = new Map<string, ActivityLogRow[]>()
  const searchesByIdentity = new Map<string, SearchAnalyticsRow[]>()
  const usersByIdentity = new Map<string, UserRow>()
  const attributionByIdentity = new Map<string, AttributionRow>()

  for (const log of logs) {
    const identity = getActorIdentity(log)
    logsByIdentity.set(identity, [...(logsByIdentity.get(identity) || []), log])
  }

  for (const search of searches) {
    const identity = getActorIdentity(search)
    searchesByIdentity.set(identity, [...(searchesByIdentity.get(identity) || []), search])
  }

  for (const user of users) {
    if (user.plan === 'admin' || user.role === 'admin') continue
    usersByIdentity.set(user.id, user)
    const email = normalizeEmail(user.email)
    if (email) usersByIdentity.set(email, user)
  }

  for (const row of attribution) {
    if (row.user_id && !attributionByIdentity.has(row.user_id)) attributionByIdentity.set(row.user_id, row)
    if (row.session_id && !attributionByIdentity.has(row.session_id)) attributionByIdentity.set(row.session_id, row)
    const email = normalizeEmail(row.email)
    if (email && !attributionByIdentity.has(email)) attributionByIdentity.set(email, row)
  }

  const identities = new Set<string>([
    ...users.filter((user) => user.plan !== 'admin' && user.role !== 'admin').map((user) => user.id),
    ...logsByIdentity.keys(),
    ...searchesByIdentity.keys(),
  ])

  return [...identities]
    .map<UserSummary>((user) => {
      const userLogs = (logsByIdentity.get(user) || []).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      const userSearches = searchesByIdentity.get(user) || []
      const realUser = usersByIdentity.get(user) || createSyntheticUser(user, userLogs, userSearches)
      const userAttribution =
        attributionByIdentity.get(user) ||
        attributionByIdentity.get(normalizeEmail(realUser.email) || '') ||
        attributionByIdentity.get(userLogs.find((log) => log.session_id)?.session_id || '')
      const paid =
        isPaidUser(realUser) ||
        userLogs.some((log) => log.event === 'payment_completed' || log.event === 'checkout_completed')
      const activationScore = scoreUser({ logs: userLogs, searches: userSearches, paid })
      const sessionIds = Array.from(new Set([...userLogs.map((log) => log.session_id), ...userSearches.map((search) => search.session_id)].filter(Boolean))) as string[]
      const searchQueries = Array.from(
        new Set(
          userSearches
            .map(getSearchQuery)
            .concat(userLogs.filter((log) => log.event === 'scrape_completed').map((log) => log.query || ''))
            .map((query) => query.trim())
            .filter(Boolean)
        )
      )

      return {
        user: realUser,
        identity: user,
        source: getSource(userAttribution),
        device: userAttribution?.device_type || '-',
        trialStatus: paid ? 'Upgraded' : realUser.plan === 'free' ? 'Trial/free' : realUser.plan || 'Unknown',
        searches: userSearches.length || userLogs.filter((log) => ['search_performed', 'first_search_performed', 'scrape_completed'].includes(log.event)).length,
        csvDownloads: userLogs.filter((log) => log.event === 'csv_downloaded').length,
        emailExports: userLogs.filter((log) => log.event === 'email_exported' || log.event === 'email_export_sent').length,
        activationScore,
        activationSegment: getActivationSegment(activationScore, paid),
        lastActive: userLogs[0]?.created_at || userSearches[0]?.created_at || null,
        viewedPricing: userLogs.some((log) => log.event === 'pricing_page_viewed' || log.event === 'plans_viewed') || userSearches.some((search) => search.viewed_pricing_after_search),
        upgradeClicked: userLogs.some((log) => log.event === 'upgrade_clicked') || userSearches.some((search) => search.clicked_upgrade_after_search),
        startedCheckout: userLogs.some((log) => log.event === 'checkout_started'),
        paid,
        sessionIds,
        searchQueries,
      }
    })
}

function getUserExportRow(summary: UserSummary) {
  return {
    email: summary.user.email,
    signup_date: summary.user.created_at,
    source: summary.source,
    device: summary.device,
    trial_status: summary.trialStatus,
    searches_count: summary.searches,
    csv_downloads_count: summary.csvDownloads,
    email_exports_count: summary.emailExports,
    activation_score: summary.activationScore,
    activation_segment: summary.activationSegment,
    last_active: summary.lastActive || '',
    upgrade_clicked: summary.upgradeClicked,
    paid_status: summary.paid,
  }
}

function makeSerializableLeakRows(rows: UserSummary[]) {
  return rows.map((summary) => getUserExportRow(summary))
}

function formatDateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10)
}

function getDatesBetween(start: Date, end: Date) {
  const dates: string[] = []
  const cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)
  const endDate = new Date(end)
  endDate.setHours(0, 0, 0, 0)

  while (cursor.getTime() <= endDate.getTime()) {
    dates.push(formatDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

function countEvents(logs: ActivityLogRow[], events: string[]) {
  const eventSet = new Set(events)
  return logs.filter((log) => eventSet.has(log.event)).length
}

function countDistinctActors(logs: ActivityLogRow[], events: string[]) {
  const eventSet = new Set(events)
  return new Set(logs.filter((log) => eventSet.has(log.event)).map(getIdentity).filter(Boolean)).size
}

function sourceMatches(
  source: string,
  row: { user_id?: string | null; email?: string | null; session_id?: string | null; utm_source?: string | null; referrer?: string | null },
  attribution: AttributionRow[]
) {
  return getEventSource(row, attribution) === source
}

function logMatchesSummary(log: ActivityLogRow, summary: UserSummary) {
  return (
    log.user_id === summary.user.id ||
    log.user_id === summary.identity ||
    normalizeEmail(log.email) === normalizeEmail(summary.user.email) ||
    normalizeEmail(log.email) === summary.identity ||
    log.session_id === summary.identity
  )
}

function searchMatchesSummary(search: SearchAnalyticsRow, summary: UserSummary) {
  return (
    search.user_id === summary.user.id ||
    search.user_id === summary.identity ||
    normalizeEmail(search.email) === normalizeEmail(summary.user.email) ||
    normalizeEmail(search.email) === summary.identity ||
    search.session_id === summary.identity
  )
}

function logMatchesSearch(log: ActivityLogRow, search: SearchAnalyticsRow) {
  return (
    Boolean(log.search_id && log.search_id === search.id) ||
    Boolean(log.user_id && log.user_id === search.user_id) ||
    Boolean(normalizeEmail(log.email) && normalizeEmail(log.email) === normalizeEmail(search.email)) ||
    Boolean(log.session_id && log.session_id === search.session_id)
  )
}

function getSearchSource(search: SearchAnalyticsRow, attribution: AttributionRow[]) {
  return getEventSource(search, attribution)
}

function buildSourcePerformance(
  logs: ActivityLogRow[],
  searches: SearchAnalyticsRow[],
  summaries: UserSummary[],
  attribution: AttributionRow[]
) {
  const sourceMap = new Map<string, SourcePerformanceRow>()
  const ensureSource = (sourceValue: string) => {
    const source = classifySource(sourceValue) || 'unknown'
    const label = SOURCE_FILTERS.find((option) => option.value === source)?.label || 'Unknown'
    const current = sourceMap.get(label)
    if (current) return current
    const row = {
      source: label,
      visits: 0,
      trials: 0,
      activated: 0,
      exports: 0,
      pricingViews: 0,
      upgradeClicks: 0,
      paidUsers: 0,
    }
    sourceMap.set(label, row)
    return row
  }

  for (const log of logs) {
    const source = getEventSource(log, attribution)
    const row = ensureSource(source)
    if (log.event === 'first_visit' || log.event === 'landing_page_view') row.visits += 1
    if (log.event === 'trial_started') row.trials += 1
    if (log.event === 'csv_downloaded' || log.event === 'email_exported' || log.event === 'email_export_sent') row.exports += 1
    if (log.event === 'pricing_page_viewed' || log.event === 'plans_viewed') row.pricingViews += 1
    if (log.event === 'upgrade_clicked') row.upgradeClicks += 1
  }

  for (const summary of summaries) {
    if (summary.activationScore >= 4 || summary.paid) {
      ensureSource(summary.source).activated += 1
    }
    if (summary.paid) {
      ensureSource(summary.source).paidUsers += 1
    }
  }

  for (const search of searches) {
    ensureSource(getSearchSource(search, attribution))
  }

  return [...sourceMap.values()]
}

function buildSearchValueRows(searches: SearchAnalyticsRow[]) {
  const grouped = new Map<string, SearchAnalyticsRow[]>()
  for (const search of searches) {
    const query = getSearchQuery(search).trim().toLowerCase()
    if (!query) continue
    grouped.set(query, [...(grouped.get(query) || []), search])
  }

  return [...grouped.entries()]
    .map<SearchValueRow>(([query, rows]) => {
      const exported = rows.filter((row) => row.downloaded_csv_after_search || row.email_exported_after_search).length
      const pricing = rows.filter((row) => row.viewed_pricing_after_search).length
      const upgraded = rows.filter((row) => row.clicked_upgrade_after_search).length
      const exportRateValue = ratio(exported, rows.length)
      return {
        query,
        searchCount: rows.length,
        exportRate: `${exportRateValue}%`,
        pricingViewRate: `${ratio(pricing, rows.length)}%`,
        upgradeRate: `${ratio(upgraded, rows.length)}%`,
        exportRateValue,
      }
    })
    .sort((a, b) => b.exportRateValue - a.exportRateValue || b.searchCount - a.searchCount)
}

function getSearchExportRow(search: SearchAnalyticsRow, attribution: AttributionRow[]) {
  return {
    search_query: getSearchQuery(search) || '-',
    user_email: search.email || '',
    source: getSearchSource(search, attribution),
    device: search.device_type || '',
    results_returned: search.number_of_results_returned || 0,
    results_with_emails: search.number_of_results_with_email || 0,
    results_with_phones: search.number_of_results_with_phone || 0,
    results_with_websites: search.number_of_results_with_website || 0,
    csv_downloaded_after_search: Boolean(search.downloaded_csv_after_search),
    email_exported_after_search: Boolean(search.email_exported_after_search),
    pricing_viewed_after_search: Boolean(search.viewed_pricing_after_search),
    upgrade_clicked_after_search: Boolean(search.clicked_upgrade_after_search),
    created_at: search.created_at,
  }
}

function getSourcePerformanceExportRow(row: SourcePerformanceRow) {
  return {
    source: row.source,
    visits: row.visits,
    trials: row.trials,
    activated: row.activated,
    exports: row.exports,
    pricing_views: row.pricingViews,
    upgrade_clicks: row.upgradeClicks,
    paid_users: row.paidUsers,
  }
}

function getSearchValueExportRow(row: SearchValueRow) {
  return {
    query: row.query,
    search_count: row.searchCount,
    export_rate: row.exportRate,
    pricing_view_rate: row.pricingViewRate,
    upgrade_rate: row.upgradeRate,
  }
}

function getLeakExportRows(leaks: {
  signedUpNeverSearched: UserSummary[]
  searchedDidNotExport: UserSummary[]
  exportedDidNotUpgrade: UserSummary[]
  clickedDidNotPay: UserSummary[]
}) {
  const leakGroups = [
    { type: 'Signed Up -> No Search', rows: leaks.signedUpNeverSearched },
    { type: 'Searched -> No Export', rows: leaks.searchedDidNotExport },
    { type: 'Exported -> No Upgrade', rows: leaks.exportedDidNotUpgrade },
    { type: 'Upgrade Clicked -> No Purchase', rows: leaks.clickedDidNotPay },
  ]

  return leakGroups.map(({ type, rows }) => ({
    leak_type: type,
    count: rows.length,
    example_users: rows.slice(0, 10).map((row) => row.user.email).join(', '),
  }))
}

function summaryMatchesFilters(
  summary: UserSummary,
  filters: {
    hideInternal: boolean
    exclusions: string[]
    userSearch: string
    activation: string
    exportType: ExportFilter
    upgradeFunnel: UpgradeFunnelFilter
    searchText: string
    searchMatchMode: SearchMatchMode
    selectedSearches: string[]
    source: SourceFilter
  }
) {
  if (filters.hideInternal && (summary.user.role === 'admin' || summary.user.plan === 'admin' || isInternalEmail(summary.user.email))) return false
  if (filters.exclusions.length > 0 && isExcludedEmail(summary.user.email, filters.exclusions)) return false

  const userNeedle = normalizeText(filters.userSearch)
  if (userNeedle) {
    const haystack = [
      summary.user.email,
      summary.user.id,
      summary.identity,
      ...summary.sessionIds,
    ].map(normalizeText)
    if (!haystack.some((value) => value.includes(userNeedle))) return false
  }

  if (filters.activation && summary.activationSegment !== filters.activation) return false

  if (filters.exportType === 'csv' && summary.csvDownloads === 0) return false
  if (filters.exportType === 'email' && summary.emailExports === 0) return false
  if (filters.exportType === 'any' && summary.csvDownloads + summary.emailExports === 0) return false
  if (filters.exportType === 'none' && summary.csvDownloads + summary.emailExports > 0) return false

  if (filters.upgradeFunnel === 'viewed_pricing' && !summary.viewedPricing) return false
  if (filters.upgradeFunnel === 'clicked_upgrade' && !summary.upgradeClicked) return false
  if (filters.upgradeFunnel === 'started_checkout' && !summary.startedCheckout) return false
  if (filters.upgradeFunnel === 'paid' && !summary.paid) return false

  if (filters.source && classifySource(summary.source) !== filters.source) return false

  const searchNeedle = normalizeText(filters.searchText)
  const normalizedQueries = summary.searchQueries.map(normalizeText)
  if (searchNeedle) {
    const queryMatches =
      filters.searchMatchMode === 'exact'
        ? normalizedQueries.some((query) => query === searchNeedle)
        : normalizedQueries.some((query) => query.includes(searchNeedle))
    if (!queryMatches) return false
  }

  if (filters.selectedSearches.length > 0) {
    const selected = new Set(filters.selectedSearches.map(normalizeText))
    if (!normalizedQueries.some((query) => selected.has(query))) return false
  }

  return true
}

function searchMatchesFilters(
  search: SearchAnalyticsRow,
  filters: {
    hideInternal: boolean
    exclusions: string[]
    userSearch: string
    exportType: ExportFilter
    upgradeFunnel: UpgradeFunnelFilter
    searchText: string
    searchMatchMode: SearchMatchMode
    selectedSearches: string[]
    source: SourceFilter
  },
  attribution: AttributionRow[]
) {
  if (filters.hideInternal && isInternalEmail(search.email)) return false
  if (filters.exclusions.length > 0 && isExcludedEmail(search.email, filters.exclusions)) return false

  const userNeedle = normalizeText(filters.userSearch)
  if (userNeedle) {
    const haystack = [search.email, search.user_id, search.session_id].map(normalizeText)
    if (!haystack.some((value) => value.includes(userNeedle))) return false
  }

  if (filters.exportType === 'csv' && !search.downloaded_csv_after_search) return false
  if (filters.exportType === 'email' && !search.email_exported_after_search) return false
  if (filters.exportType === 'any' && !search.downloaded_csv_after_search && !search.email_exported_after_search) return false
  if (filters.exportType === 'none' && (search.downloaded_csv_after_search || search.email_exported_after_search)) return false

  if (filters.upgradeFunnel === 'viewed_pricing' && !search.viewed_pricing_after_search) return false
  if (filters.upgradeFunnel === 'clicked_upgrade' && !search.clicked_upgrade_after_search) return false
  if (filters.upgradeFunnel === 'started_checkout' && !search.started_checkout_after_search) return false
  if (filters.upgradeFunnel === 'paid' && !search.paid_after_search) return false

  if (filters.source && classifySource(getSearchSource(search, attribution)) !== filters.source) return false

  const query = normalizeText(getSearchQuery(search))
  const searchNeedle = normalizeText(filters.searchText)
  if (searchNeedle) {
    const matches = filters.searchMatchMode === 'exact' ? query === searchNeedle : query.includes(searchNeedle)
    if (!matches) return false
  }

  if (filters.selectedSearches.length > 0) {
    const selected = new Set(filters.selectedSearches.map(normalizeText))
    if (!selected.has(query)) return false
  }

  return true
}

function buildGrowthReport(params: {
  rangeLabel: string
  start: Date
  end: Date
  logs: ActivityLogRow[]
  searches: SearchAnalyticsRow[]
  users: UserRow[]
  summaries: UserSummary[]
  attribution: AttributionRow[]
}) {
  const { rangeLabel, start, end, logs, searches, users, summaries, attribution } = params
  const websiteVisits = countEvents(logs, ['first_visit', 'landing_page_view'])
  const signups = users.length || countDistinctActors(logs, ['signup_completed'])
  const trialsStarted = countEvents(logs, ['trial_started'])
  const activatedUsers = summaries.filter((summary) => summary.activationScore >= 4 || summary.paid).length
  const searchesPerformed = searches.length || countEvents(logs, ['search_performed', 'first_search_performed', 'scrape_completed'])
  const csvDownloads = countEvents(logs, ['csv_downloaded'])
  const emailExports = countEvents(logs, ['email_exported', 'email_export_sent'])
  const exportCount = csvDownloads + emailExports
  const pricingPageViews = countEvents(logs, ['pricing_page_viewed', 'plans_viewed'])
  const upgradeClicks = countEvents(logs, ['upgrade_clicked'])
  const checkoutStarts = countEvents(logs, ['checkout_started'])
  const paidUsers = countEvents(logs, ['payment_completed', 'checkout_completed']) || summaries.filter((summary) => summary.paid).length
  const firstSearchActors = new Set(searches.map(getIdentity).filter(Boolean))
  const exportActors = countDistinctActors(logs, ['csv_downloaded', 'email_exported', 'email_export_sent'])
  const upgradeActors = countDistinctActors(logs, ['upgrade_clicked'])
  const checkoutActors = countDistinctActors(logs, ['checkout_started'])
  const paidActors = countDistinctActors(logs, ['payment_completed', 'checkout_completed'])
  const returningUsers = summaries.filter((summary) => {
    const userLogs = logs.filter((log) => logMatchesSummary(log, summary))
    if (userLogs.length < 2) return false
    const sorted = userLogs.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    return +new Date(sorted[sorted.length - 1].created_at) - +new Date(sorted[0].created_at) >= 24 * 60 * 60 * 1000
  }).length

  const sources = new Set<string>(['direct'])
  attribution.forEach((row) => sources.add(getSource(row)))
  logs.forEach((log) => sources.add(getEventSource(log, attribution)))
  searches.forEach((search) => sources.add(getSearchSource(search, attribution)))

  const acquisitionBreakdown = [...sources].map((source) => {
    const sourceLogs = logs.filter((log) => sourceMatches(source, log, attribution))
    const sourceUsers = users.filter((user) => sourceMatches(source, { user_id: user.id, email: user.email }, attribution))
    const sourceSearches = searches.filter((search) => sourceMatches(source, search, attribution))
    const sourceSummaries = summaries.filter((summary) => classifySource(summary.source) === classifySource(source))
    return {
      source,
      visits: countEvents(sourceLogs, ['first_visit', 'landing_page_view']),
      signups: sourceUsers.length || countDistinctActors(sourceLogs, ['signup_completed']),
      trials: countEvents(sourceLogs, ['trial_started']),
      activated: sourceSummaries.filter((summary) => summary.activationScore >= 4 || summary.paid).length,
      searches: sourceSearches.length || countEvents(sourceLogs, ['search_performed', 'first_search_performed', 'scrape_completed']),
      exports: countEvents(sourceLogs, ['csv_downloaded', 'email_exported', 'email_export_sent']),
      pricing_views: countEvents(sourceLogs, ['pricing_page_viewed', 'plans_viewed']),
      upgrade_clicks: countEvents(sourceLogs, ['upgrade_clicked']),
      paid_users: sourceSummaries.filter((summary) => summary.paid).length || countEvents(sourceLogs, ['payment_completed', 'checkout_completed']),
    }
  })

  const searchesByQuery = new Map<string, SearchAnalyticsRow[]>()
  for (const search of searches) {
    const query = (search.search_query || search.business_type || 'unknown').trim().toLowerCase()
    searchesByQuery.set(query, [...(searchesByQuery.get(query) || []), search])
  }

  const searchIntelligence = [...searchesByQuery.entries()]
    .map(([query, rows]) => {
      const exported = rows.filter((row) => row.downloaded_csv_after_search || row.email_exported_after_search).length
      const upgraded = rows.filter((row) => row.clicked_upgrade_after_search).length
      const abandoned = rows.filter(
        (row) =>
          !row.opened_lead_detail &&
          !row.downloaded_csv_after_search &&
          !row.email_exported_after_search &&
          !row.viewed_pricing_after_search &&
          !row.clicked_upgrade_after_search
      ).length
      return {
        search_query: query,
        search_count: rows.length,
        average_results_returned: Math.round(rows.reduce((sum, row) => sum + row.number_of_results_returned, 0) / rows.length),
        export_rate: `${ratio(exported, rows.length)}%`,
        upgrade_rate: `${ratio(upgraded, rows.length)}%`,
        no_result_searches: rows.filter((row) => row.no_results || row.number_of_results_returned === 0).length,
        high_abandonment_searches: abandoned,
      }
    })
    .sort((a, b) => Number(b.search_count) - Number(a.search_count))

  const userEvents = (summary: UserSummary, eventNames: string[]) =>
    logs.some((log) => logMatchesSummary(log, summary) && eventNames.includes(log.event))
  const userSearches = (summary: UserSummary) => searches.filter((search) => searchMatchesSummary(search, summary))

  const conversionLeaks = {
    signed_up_but_never_searched: summaries.filter((summary) => summary.searches === 0 && !summary.paid),
    searched_but_never_opened_leads: summaries.filter(
      (summary) => summary.searches > 0 && !userEvents(summary, ['lead_detail_viewed']) && !userSearches(summary).some((search) => search.opened_lead_detail)
    ),
    opened_leads_but_never_exported: summaries.filter(
      (summary) =>
        (userEvents(summary, ['lead_detail_viewed']) || userSearches(summary).some((search) => search.opened_lead_detail)) &&
        summary.csvDownloads + summary.emailExports === 0
    ),
    exported_but_never_viewed_pricing: summaries.filter(
      (summary) =>
        summary.csvDownloads + summary.emailExports > 0 &&
        !userEvents(summary, ['pricing_page_viewed', 'plans_viewed']) &&
        !userSearches(summary).some((search) => search.viewed_pricing_after_search)
    ),
    viewed_pricing_but_never_clicked_upgrade: summaries.filter(
      (summary) =>
        (userEvents(summary, ['pricing_page_viewed', 'plans_viewed']) || userSearches(summary).some((search) => search.viewed_pricing_after_search)) &&
        !summary.upgradeClicked
    ),
    clicked_upgrade_but_never_paid: summaries.filter((summary) => summary.upgradeClicked && !summary.paid),
  }

  const dailyMetrics = getDatesBetween(start, end).map((date) => {
    const dayLogs = logs.filter((log) => formatDateKey(log.created_at) === date)
    const dayUsers = users.filter((user) => formatDateKey(user.created_at) === date)
    const daySearches = searches.filter((search) => formatDateKey(search.created_at) === date)
    const daySummaries = summaries.filter((summary) => formatDateKey(summary.lastActive || summary.user.created_at) === date)
    return {
      date,
      visits: countEvents(dayLogs, ['first_visit', 'landing_page_view']),
      signups: dayUsers.length || countDistinctActors(dayLogs, ['signup_completed']),
      trials: countEvents(dayLogs, ['trial_started']),
      activated: daySummaries.filter((summary) => summary.activationScore >= 4 || summary.paid).length,
      searches: daySearches.length || countEvents(dayLogs, ['search_performed', 'first_search_performed', 'scrape_completed']),
      exports: countEvents(dayLogs, ['csv_downloaded', 'email_exported', 'email_export_sent']),
      pricing_views: countEvents(dayLogs, ['pricing_page_viewed', 'plans_viewed']),
      upgrade_clicks: countEvents(dayLogs, ['upgrade_clicked']),
      paid_users: countEvents(dayLogs, ['payment_completed', 'checkout_completed']),
    }
  })

  const funnelSummary = {
    website_visits: websiteVisits,
    signups,
    trials_started: trialsStarted,
    activated_users: activatedUsers,
    searches_performed: searchesPerformed,
    csv_downloads: csvDownloads,
    email_exports: emailExports,
    pricing_page_views: pricingPageViews,
    upgrade_clicks: upgradeClicks,
    checkout_starts: checkoutStarts,
    paid_users: paidUsers,
  }

  return {
    generated_at: new Date().toISOString(),
    date_range: {
      label: rangeLabel,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    funnel_summary: funnelSummary,
    conversion_rates: {
      visit_to_signup: pct(signups, websiteVisits),
      signup_to_trial: pct(trialsStarted, signups),
      trial_to_first_search: pct(firstSearchActors.size || searchesPerformed, trialsStarted),
      first_search_to_export: pct(exportActors, firstSearchActors.size || searchesPerformed),
      export_to_upgrade_click: pct(upgradeActors, exportActors),
      upgrade_click_to_checkout: pct(checkoutActors, upgradeActors),
      checkout_to_paid: pct(paidActors || paidUsers, checkoutActors),
      trial_to_paid: pct(paidUsers, trialsStarted),
    },
    acquisition_breakdown: acquisitionBreakdown,
    source_performance: buildSourcePerformance(logs, searches, summaries, attribution).map(getSourcePerformanceExportRow),
    search_intelligence: searchIntelligence,
    search_value_analytics: buildSearchValueRows(searches).map(getSearchValueExportRow),
    user_activity: summaries.map(getUserExportRow),
    activation_metrics: {
      activated_users: activatedUsers,
      average_activation_score: summaries.length
        ? Math.round((summaries.reduce((sum, summary) => sum + summary.activationScore, 0) / summaries.length) * 10) / 10
        : 0,
      users_returning_after_24_hours: returningUsers,
      most_engaged_users: summaries
        .slice()
        .sort((a, b) => b.activationScore - a.activationScore)
        .slice(0, 25)
        .map(getUserExportRow),
    },
    conversion_leaks: Object.fromEntries(
      Object.entries(conversionLeaks).map(([key, rows]) => [key, makeSerializableLeakRows(rows)])
    ),
    daily_metrics: dailyMetrics,
    top_searches: searchIntelligence.slice(0, 25),
    worst_searches: searchIntelligence
      .slice()
      .sort((a, b) => Number(b.no_result_searches) + Number(b.high_abandonment_searches) - (Number(a.no_result_searches) + Number(a.high_abandonment_searches)))
      .slice(0, 25),
    upgrade_funnel: {
      exports: exportCount,
      pricing_page_views: pricingPageViews,
      upgrade_clicks: upgradeClicks,
      checkout_starts: checkoutStarts,
      paid_users: paidUsers,
      export_to_upgrade_click: pct(upgradeClicks, exportCount),
      upgrade_click_to_checkout: pct(checkoutStarts, upgradeClicks),
      checkout_to_paid: pct(paidUsers, checkoutStarts),
    },
    paid_conversion_summary: {
      activated_users: activatedUsers,
      paid_users: paidUsers,
      activated_to_paid_rate: pct(paidUsers, activatedUsers),
      trials_started: trialsStarted,
      trial_to_paid_rate: pct(paidUsers, trialsStarted),
      checkout_starts: checkoutStarts,
      checkout_to_paid_rate: pct(paidUsers, checkoutStarts),
    },
  } satisfies GrowthReport
}

function flattenReportForCsv(params: {
  report: GrowthReport
  users: UserSummary[]
  searches: SearchAnalyticsRow[]
  leaks: {
    signedUpNeverSearched: UserSummary[]
    searchedDidNotExport: UserSummary[]
    exportedDidNotUpgrade: UserSummary[]
    clickedDidNotPay: UserSummary[]
  }
  attribution: AttributionRow[]
}) {
  const { report, users, searches, leaks, attribution } = params
  const rows: Array<Record<string, string | number | boolean>> = []
  const addMetricSection = (section: string, values: Record<string, string | number>) => {
    Object.entries(values).forEach(([metric, value]) => rows.push({ section, metric, value }))
  }

  addMetricSection('Funnel Summary', report.funnel_summary)
  addMetricSection('Conversion Rates', report.conversion_rates)
  report.source_performance.forEach((row) => rows.push({ section: 'Source Performance', ...row }))
  report.acquisition_breakdown.forEach((row) => rows.push({ section: 'Acquisition Breakdown', ...row }))
  users.forEach((summary) => rows.push({ section: 'Users', ...getUserExportRow(summary) }))
  searches.forEach((search) => rows.push({ section: 'Searches', ...getSearchExportRow(search, attribution) }))
  report.search_intelligence.forEach((row) => rows.push({ section: 'Search Intelligence', ...row }))
  report.search_value_analytics.forEach((row) => rows.push({ section: 'Search Value Analytics', ...row }))
  Object.entries(report.activation_metrics).forEach(([metric, value]) => {
    if (Array.isArray(value)) return
    rows.push({ section: 'Activation Metrics', metric, value })
  })
  report.activation_metrics.most_engaged_users.forEach((row) => rows.push({ section: 'Most Engaged Users', ...row }))
  getLeakExportRows(leaks).forEach((row) => rows.push({ section: 'Conversion Leaks', ...row }))
  report.daily_metrics.forEach((row) => rows.push({ section: 'Daily Trend Data', ...row }))
  return rows
}

function toCsv(rows: Array<Record<string, string | number | boolean>>) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const escape = (value: unknown) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n')
}

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function AdminGrowthDashboard({
  initialLogs,
  users,
  searches,
  attribution,
  followUps,
  delayDays,
}: {
  initialLogs: ActivityLogRow[]
  users: UserRow[]
  searches: SearchAnalyticsRow[]
  attribution: AttributionRow[]
  followUps: LeadFollowUpRow[]
  delayDays: number
}) {
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [startDate, setStartDate] = useState(getTodayDateInput())
  const [endDate, setEndDate] = useState(getTodayDateInput())
  const [includeInternal, setIncludeInternal] = useState(false)
  const [exclusionList, setExclusionList] = useState('mindrasolutions.com\nmartin@mindrasolutions.com')
  const [userSearch, setUserSearch] = useState('')
  const [activationFilter, setActivationFilter] = useState('')
  const [exportFilter, setExportFilter] = useState<ExportFilter>('')
  const [upgradeFunnelFilter, setUpgradeFunnelFilter] = useState<UpgradeFunnelFilter>('')
  const [searchText, setSearchText] = useState('')
  const [searchMatchMode, setSearchMatchMode] = useState<SearchMatchMode>('contains')
  const [selectedSearches, setSelectedSearches] = useState<string[]>([])
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('')
  const [sourceSort, setSourceSort] = useState<SortKey>('paid')
  const [userPage, setUserPage] = useState(0)
  const [searchPage, setSearchPage] = useState(0)
  const [leakPage, setLeakPage] = useState(0)
  const [leaksExpanded, setLeaksExpanded] = useState(false)
  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS_OPEN)
  const [sectionsHydrated, setSectionsHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SECTION_STORAGE_KEY)
      if (raw) {
        setSectionsOpen({ ...DEFAULT_SECTIONS_OPEN, ...JSON.parse(raw) })
      }
    } catch {}

    setSectionsHydrated(true)
  }, [])

  useEffect(() => {
    if (!sectionsHydrated) return

    try {
      window.sessionStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(sectionsOpen))
    } catch {}
  }, [sectionsHydrated, sectionsOpen])

  const { snapshot, userSummaries, filteredSearches, leaks, sourcePerformance, rangeLogs, rangeBounds } = useMemo(() => {
    const { start, end } = getRangeBounds(dateRange, startDate, endDate)
    const effectiveSearches = buildEffectiveSearches(searches, initialLogs)
    const summaries = buildUserSummaries(users, initialLogs, effectiveSearches, attribution)
    const exclusions = parseExclusionList(exclusionList)
    const excludedIdentities = new Set(
      includeInternal ? [] : summaries.filter((summary) => isInternalSummary(summary, exclusions)).map((summary) => summary.identity)
    )
    const logs = initialLogs
      .filter((log) => inRange(log.created_at, start, end))
      .filter((log) => includeInternal || !isInternalLog(log, excludedIdentities, exclusions))
    const rangeSearches = effectiveSearches
      .filter((search) => inRange(search.created_at, start, end))
      .filter((search) => includeInternal || !isInternalSearch(search, excludedIdentities, exclusions))
    const rangeUsers = users
      .filter((user) => inRange(user.created_at, start, end))
      .filter((user) => includeInternal || (!user.analytics_excluded && !isInternalEmail(user.email) && !isExcludedEmail(user.email, exclusions)))
    const rangeSummaries = summaries
      .filter((summary) => inRange(summary.user.created_at, start, end) || inRange(summary.lastActive, start, end))
      .filter((summary) => includeInternal || !isInternalSummary(summary, exclusions))
    const activatedUsers = rangeSummaries.filter((summary) => summary.activationScore >= 4 || summary.paid).length
    const paidUsers = rangeSummaries.filter((summary) => summary.paid).length
    const websiteVisits = logs.filter((log) => log.event === 'first_visit' || log.event === 'landing_page_view').length
    const trialStarts = logs.filter((log) => log.event === 'trial_started').length || rangeUsers.length
    const upgradeClicks = logs.filter((log) => log.event === 'upgrade_clicked').length
    const checkoutStarts = logs.filter((log) => log.event === 'checkout_started').length
    const paymentCompleted = logs.filter((log) => log.event === 'payment_completed' || log.event === 'checkout_completed').length || paidUsers

    return {
      snapshot: {
        websiteVisits,
        trialsStarted: trialStarts,
        activatedUsers,
        searchesPerformed: rangeSearches.length || logs.filter((log) => ['search_performed', 'first_search_performed', 'scrape_completed'].includes(log.event)).length,
        csvDownloads: logs.filter((log) => log.event === 'csv_downloaded').length,
        emailExports: logs.filter((log) => log.event === 'email_exported' || log.event === 'email_export_sent').length,
        pricingViews: logs.filter((log) => log.event === 'pricing_page_viewed' || log.event === 'plans_viewed').length,
        upgradeClicks,
        checkoutStarts,
        paidUsers: paymentCompleted,
        visitToTrialRate: pct(trialStarts, websiteVisits),
        trialToActivationRate: pct(activatedUsers, trialStarts),
        activationToUpgradeRate: pct(upgradeClicks, activatedUsers),
        upgradeToPaidRate: pct(paymentCompleted, upgradeClicks),
      },
      userSummaries: rangeSummaries,
      filteredSearches: rangeSearches,
      rangeLogs: logs,
      rangeBounds: { start, end },
      sourcePerformance: buildSourcePerformance(logs, rangeSearches, rangeSummaries, attribution).sort((a, b) => {
        if (sourceSort === 'trials') return b.trials - a.trials
        if (sourceSort === 'activated') return b.activated - a.activated
        return b.paidUsers - a.paidUsers
      }),
      leaks: {
        signedUpNeverSearched: rangeSummaries.filter((summary) => summary.searches === 0 && !summary.paid),
        searchedDidNotExport: rangeSummaries.filter((summary) => summary.searches > 0 && summary.csvDownloads === 0 && summary.emailExports === 0 && !summary.paid),
        exportedDidNotUpgrade: rangeSummaries.filter((summary) => summary.csvDownloads + summary.emailExports > 0 && !summary.upgradeClicked && !summary.paid),
        clickedDidNotPay: rangeSummaries.filter((summary) => summary.upgradeClicked && !summary.paid),
      },
    }
  }, [attribution, dateRange, endDate, exclusionList, includeInternal, initialLogs, searches, sourceSort, startDate, users])

  const commonSearches = useMemo(() => {
    const counts = new Map<string, number>()
    for (const search of filteredSearches) {
      const query = getSearchQuery(search).trim()
      if (!query) continue
      const key = query.toLowerCase()
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([query, count]) => ({ query, count }))
  }, [filteredSearches])

  const filteredView = useMemo(() => {
    const filters = {
      hideInternal: !includeInternal,
      exclusions: parseExclusionList(exclusionList),
      userSearch,
      activation: activationFilter,
      exportType: exportFilter,
      upgradeFunnel: upgradeFunnelFilter,
      searchText,
      searchMatchMode,
      selectedSearches,
      source: sourceFilter,
    }
    const usersForDisplay = userSummaries.filter((summary) => summaryMatchesFilters(summary, filters))
    const searchesForDisplay = filteredSearches.filter((search) => searchMatchesFilters(search, filters, attribution))

    return {
      users: usersForDisplay,
      searches: searchesForDisplay,
      leaks: {
        signedUpNeverSearched: leaks.signedUpNeverSearched.filter((summary) => summaryMatchesFilters(summary, filters)),
        searchedDidNotExport: leaks.searchedDidNotExport.filter((summary) => summaryMatchesFilters(summary, filters)),
        exportedDidNotUpgrade: leaks.exportedDidNotUpgrade.filter((summary) => summaryMatchesFilters(summary, filters)),
        clickedDidNotPay: leaks.clickedDidNotPay.filter((summary) => summaryMatchesFilters(summary, filters)),
      },
    }
  }, [
    activationFilter,
    attribution,
    exclusionList,
    exportFilter,
    filteredSearches,
    includeInternal,
    leaks,
    searchMatchMode,
    searchText,
    selectedSearches,
    sourceFilter,
    upgradeFunnelFilter,
    userSearch,
    userSummaries,
  ])

  const visibleSourcePerformance = useMemo(
    () =>
      sourceFilter
        ? sourcePerformance.filter((row) => classifySource(row.source) === sourceFilter)
        : sourcePerformance,
    [sourceFilter, sourcePerformance]
  )
  const visibleSearchValueRows = useMemo(
    () => buildSearchValueRows(filteredView.searches),
    [filteredView.searches]
  )
  const filteredReport = useMemo(() => {
    const hasEntityFilters = Boolean(
      normalizeText(userSearch) ||
        activationFilter ||
        exportFilter ||
        upgradeFunnelFilter ||
        normalizeText(searchText) ||
        selectedSearches.length > 0
    )
    const reportLogs = rangeLogs.filter((log) => {
      if (sourceFilter && classifySource(getEventSource(log, attribution)) !== sourceFilter) return false
      if (!hasEntityFilters) return true
      return (
        filteredView.users.some((summary) => logMatchesSummary(log, summary)) ||
        filteredView.searches.some((search) => logMatchesSearch(log, search))
      )
    })

    return buildGrowthReport({
      rangeLabel: getRangeLabel(dateRange, startDate, endDate),
      start: rangeBounds.start,
      end: rangeBounds.end,
      logs: reportLogs,
      searches: filteredView.searches,
      users: filteredView.users.map((summary) => summary.user),
      summaries: filteredView.users,
      attribution,
    })
  }, [
    activationFilter,
    attribution,
    dateRange,
    endDate,
    exportFilter,
    filteredView.searches,
    filteredView.users,
    rangeBounds.end,
    rangeBounds.start,
    rangeLogs,
    searchText,
    selectedSearches.length,
    sourceFilter,
    startDate,
    upgradeFunnelFilter,
    userSearch,
  ])

  function toggleCommonSearch(query: string) {
    setSelectedSearches((current) =>
      current.includes(query) ? current.filter((item) => item !== query) : [...current, query]
    )
  }

  function clearFilters() {
    setIncludeInternal(false)
    setExclusionList('mindrasolutions.com\nmartin@mindrasolutions.com')
    setUserSearch('')
    setActivationFilter('')
    setExportFilter('')
    setUpgradeFunnelFilter('')
    setSearchText('')
    setSearchMatchMode('contains')
    setSelectedSearches([])
    setSourceFilter('')
    setUserPage(0)
    setSearchPage(0)
    setLeakPage(0)
  }

  function toggleSection(section: SectionKey) {
    setSectionsOpen((current) => {
      const next = { ...current, [section]: !current[section] }
      return next
    })
  }

  const userPageRows = paginate(filteredView.users, userPage)
  const searchPageRows = paginate(filteredView.searches, searchPage)
  const allLeakRows = [
    ...filteredView.leaks.signedUpNeverSearched.map((row) => ({ type: 'Signed Up -> No Search', row })),
    ...filteredView.leaks.searchedDidNotExport.map((row) => ({ type: 'Searched -> No Export', row })),
    ...filteredView.leaks.exportedDidNotUpgrade.map((row) => ({ type: 'Exported -> No Upgrade', row })),
    ...filteredView.leaks.clickedDidNotPay.map((row) => ({ type: 'Upgrade Clicked -> No Purchase', row })),
  ]
  const visibleLeakRows = leaksExpanded ? allLeakRows : allLeakRows.slice(0, 10)
  const leakPageRows = paginate(visibleLeakRows, leakPage)

  function getExportFilename(kind: string, extension: string) {
    const rangeSlug =
      dateRange === 'custom'
        ? `custom_${startDate || 'beginning'}_${endDate || 'today'}`
        : dateRange === '7d'
          ? '7days'
          : dateRange === '14d'
            ? '14days'
            : dateRange === '30d'
              ? '30days'
              : dateRange
    return `${kind}_${rangeSlug}_${getTodayDateInput()}.${extension}`
  }

  function exportCsv() {
    downloadText(
      getExportFilename('analytics', 'csv'),
      toCsv(
        flattenReportForCsv({
          report: filteredReport,
          users: filteredView.users,
          searches: filteredView.searches,
          leaks: filteredView.leaks,
          attribution,
        })
      ),
      'text/csv;charset=utf-8'
    )
  }

  function exportJson() {
    const jsonReport = {
      funnel_summary: filteredReport.funnel_summary,
      source_performance: filteredReport.source_performance,
      search_intelligence: filteredReport.search_intelligence,
      search_value_analytics: filteredReport.search_value_analytics,
      conversion_leaks: getLeakExportRows(filteredView.leaks),
      user_activity: filteredReport.user_activity,
      daily_metrics: filteredReport.daily_metrics,
    }

    downloadText(
      getExportFilename('analytics', 'json'),
      JSON.stringify(jsonReport, null, 2),
      'application/json;charset=utf-8'
    )
  }

  function exportAiJson() {
    const aiReport = {
      instructions:
        'Analyze this ALPA weekly growth data. Identify conversion bottlenecks, strongest acquisition sources, search patterns that indicate product value, weak searches, activation gaps, and the highest-leverage experiments for next week.',
      date_range: filteredReport.date_range,
      filters: {
        date_range: getRangeLabel(dateRange, startDate, endDate),
        source: sourceFilter || 'all',
        activation: activationFilter || 'all',
        exports: exportFilter || 'all',
        funnel_stage: upgradeFunnelFilter || 'all',
        search_query: searchText || selectedSearches.join(', ') || 'all',
        internal_activity: includeInternal ? 'included' : 'excluded',
      },
      funnel_summary: filteredReport.funnel_summary,
      conversion_rates: filteredReport.conversion_rates,
      source_performance: filteredReport.source_performance,
      activation_metrics: filteredReport.activation_metrics,
      search_value_analytics: filteredReport.search_value_analytics,
      conversion_leaks: getLeakExportRows(filteredView.leaks),
      daily_trends: filteredReport.daily_metrics,
      top_searches: filteredReport.top_searches,
      worst_searches: filteredReport.worst_searches,
      upgrade_funnel: filteredReport.upgrade_funnel,
      paid_conversion_summary: filteredReport.paid_conversion_summary,
    }

    downloadText(
      getExportFilename('ai_growth_analysis', 'json'),
      JSON.stringify(aiReport, null, 2),
      'application/json;charset=utf-8'
    )
  }

  return (
    <div className="space-y-8">
      <header className="rounded-[28px] bg-white/[0.04] p-7 shadow-[0_24px_80px_rgba(2,8,23,0.22)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/80">Admin</div>
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Analytics</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Source, trial, activation, search behavior, export intent, and paid conversion.
            </p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] px-4 py-3 text-sm font-medium text-slate-200">
            Internal activity {includeInternal ? 'included' : 'excluded'}
          </div>
        </div>
      </header>

      <StickyFilterBar>
        <FilterSelect label="Date" value={dateRange} onChange={(value) => setDateRange(value as DateRange)}>
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Source" value={sourceFilter} onChange={(value) => setSourceFilter(value as SourceFilter)}>
          {SOURCE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Activation" value={activationFilter} onChange={setActivationFilter}>
          <option value="">All Segments</option>
          {ACTIVATION_FILTERS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </FilterSelect>
        <FilterSelect label="Exports" value={exportFilter} onChange={(value) => setExportFilter(value as ExportFilter)}>
          <option value="">All</option>
          <option value="csv">CSV</option>
          <option value="email">Email</option>
          <option value="any">Any</option>
          <option value="none">None</option>
        </FilterSelect>
        <FilterSelect label="Funnel" value={upgradeFunnelFilter} onChange={(value) => setUpgradeFunnelFilter(value as UpgradeFunnelFilter)}>
          <option value="">All Stages</option>
          <option value="viewed_pricing">Pricing</option>
          <option value="clicked_upgrade">Upgrade</option>
          <option value="started_checkout">Checkout</option>
          <option value="paid">Paid</option>
        </FilterSelect>
        <FilterInput label="Search Query" value={searchText} onChange={setSearchText} placeholder="Query" />
        <FilterInput label="User" value={userSearch} onChange={setUserSearch} placeholder="Email / ID / session" />
        <FilterSelect label="Match" value={searchMatchMode} onChange={(value) => setSearchMatchMode(value as SearchMatchMode)}>
          <option value="contains">Contains</option>
          <option value="exact">Exact</option>
        </FilterSelect>
        <label className="flex min-h-[48px] items-center gap-2 rounded-2xl bg-slate-950/50 px-3 text-xs font-semibold text-slate-200">
          <input
            type="checkbox"
            checked={includeInternal}
            onChange={(event) => setIncludeInternal(event.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-slate-950"
          />
          Include Internal
        </label>
        <FilterInput label="Exclude" value={exclusionList} onChange={setExclusionList} placeholder="email/domain" />
        <button
          type="button"
          onClick={clearFilters}
          className="min-h-[48px] rounded-2xl bg-white/[0.08] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
        >
          Reset
        </button>
        {commonSearches.slice(0, 6).map((item) => (
          <button
            key={item.query}
            type="button"
            onClick={() => toggleCommonSearch(item.query)}
            className={`min-h-[34px] rounded-2xl px-3 text-xs font-semibold transition ${
              selectedSearches.includes(item.query)
                ? 'bg-white text-slate-950'
                : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-white'
            }`}
          >
            {item.query} ({item.count})
          </button>
        ))}
      </StickyFilterBar>

      {dateRange === 'custom' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-lg">
          <DateInput label="Start Date" value={startDate} onChange={setStartDate} />
          <DateInput label="End Date" value={endDate} onChange={setEndDate} />
        </div>
      ) : null}

      <section className="rounded-[28px] bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(2,8,23,0.18)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Export Analytics</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Download the active filtered analytics view for growth reviews, reporting, and ChatGPT analysis.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="min-h-[42px] rounded-2xl bg-white px-4 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
            >
              CSV Export
            </button>
            <button
              type="button"
              onClick={exportJson}
              className="min-h-[42px] rounded-2xl bg-white/[0.08] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
            >
              JSON Export
            </button>
            <button
              type="button"
              onClick={exportAiJson}
              className="min-h-[42px] rounded-2xl bg-cyan-300/15 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/22"
            >
              AI Growth Analysis Export
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <ExportStat label="Range" value={filteredReport.date_range.label} />
          <ExportStat
            label="CSV Rows"
            value={flattenReportForCsv({
              report: filteredReport,
              users: filteredView.users,
              searches: filteredView.searches,
              leaks: filteredView.leaks,
              attribution,
            }).length.toLocaleString()}
          />
          <ExportStat label="Internal Activity" value={includeInternal ? 'Included' : 'Excluded'} />
        </div>
      </section>

      <CollapsibleSection title="Funnel Summary" open={sectionsOpen.summary} onToggle={() => toggleSection('summary')}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Website Visits" value={snapshot.websiteVisits} />
          <KpiCard label="Signups / Free Trials" value={snapshot.trialsStarted} />
          <KpiCard label="Activated Users" value={snapshot.activatedUsers} />
          <KpiCard label="Searches Performed" value={snapshot.searchesPerformed} />
          <KpiCard label="CSV Downloads" value={snapshot.csvDownloads} />
          <KpiCard label="Email Exports" value={snapshot.emailExports} />
          <KpiCard label="Pricing Page Views" value={snapshot.pricingViews} />
          <KpiCard label="Upgrade Clicks" value={snapshot.upgradeClicks} />
          <KpiCard label="Checkout Starts" value={snapshot.checkoutStarts} />
          <KpiCard label="Paid Users" value={snapshot.paidUsers} />
          <KpiCard label="Trial to Activation" value={snapshot.trialToActivationRate} />
          <KpiCard label="Activation to Upgrade" value={snapshot.activationToUpgradeRate} />
          <KpiCard label="Upgrade to Paid" value={snapshot.upgradeToPaidRate} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Source Performance" open={sectionsOpen.source} onToggle={() => toggleSection('source')}>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['paid', 'activated', 'trials'] as SortKey[]).map((sort) => (
            <button
              key={sort}
              type="button"
              onClick={() => setSourceSort(sort)}
              className={`min-h-[34px] rounded-2xl px-3 text-xs font-semibold transition ${
                sourceSort === sort ? 'bg-white text-slate-950' : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]'
              }`}
            >
              Sort by {sort}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/8">
          <div className="min-w-[900px]">
            <TableHeader columns={['Source', 'Visits', 'Trials', 'Activated', 'Exports', 'Pricing Views', 'Upgrade Clicks', 'Paid Users']} />
            {visibleSourcePerformance.map((row) => (
              <div key={row.source} className="grid grid-cols-8 gap-3 border-t border-white/6 px-4 py-3 text-sm text-slate-300">
                <Cell>{row.source}</Cell>
                <Cell>{row.visits}</Cell>
                <Cell>{row.trials}</Cell>
                <Cell>{row.activated}</Cell>
                <Cell>{row.exports}</Cell>
                <Cell>{row.pricingViews}</Cell>
                <Cell>{row.upgradeClicks}</Cell>
                <Cell>{row.paidUsers}</Cell>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Search Intelligence" open={sectionsOpen.search} onToggle={() => toggleSection('search')}>
        <div className="overflow-x-auto rounded-2xl border border-white/8">
          <div className="min-w-[760px]">
            <TableHeader columns={['Search Query', 'Search Count', 'Export Rate', 'Pricing View Rate', 'Upgrade Rate']} />
            {visibleSearchValueRows.slice(0, 50).map((row) => (
              <div key={row.query} className="grid grid-cols-5 gap-3 border-t border-white/6 px-4 py-3 text-sm text-slate-300">
                <Cell>{row.query}</Cell>
                <Cell>{row.searchCount}</Cell>
                <Cell>{row.exportRate}</Cell>
                <Cell>{row.pricingViewRate}</Cell>
                <Cell>{row.upgradeRate}</Cell>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Conversion Leaks" open={sectionsOpen.leaks} onToggle={() => toggleSection('leaks')}>
        <div className="grid gap-4 lg:grid-cols-4">
          <LeakCard label="Signed Up -> No Search" rows={filteredView.leaks.signedUpNeverSearched.slice(0, 10)} />
          <LeakCard label="Searched -> No Export" rows={filteredView.leaks.searchedDidNotExport.slice(0, 10)} />
          <LeakCard label="Exported -> No Upgrade" rows={filteredView.leaks.exportedDidNotUpgrade.slice(0, 10)} />
          <LeakCard label="Upgrade Clicked -> No Purchase" rows={filteredView.leaks.clickedDidNotPay.slice(0, 10)} />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setLeaksExpanded((current) => !current)
              setLeakPage(0)
            }}
            className="min-h-[38px] rounded-2xl bg-white/[0.08] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
          >
            {leaksExpanded ? 'Show First 10' : 'View All'}
          </button>
          {leaksExpanded ? <PaginationControls page={leakPage} total={visibleLeakRows.length} onPageChange={setLeakPage} /> : null}
        </div>
        {leaksExpanded ? (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/8">
            <div className="min-w-[900px]">
              <TableHeader columns={['Leak', 'Email', 'Source', 'Activation', 'Searches', 'Exports', 'Upgrade', 'Paid']} />
              {leakPageRows.map(({ type, row }) => (
                <div key={`${type}-${row.identity}`} className="grid grid-cols-8 gap-3 border-t border-white/6 px-4 py-3 text-sm text-slate-300">
                  <Cell>{type}</Cell>
                  <Cell>{row.user.email}</Cell>
                  <Cell>{row.source}</Cell>
                  <Cell>{row.activationSegment}</Cell>
                  <Cell>{row.searches}</Cell>
                  <Cell>{row.csvDownloads + row.emailExports}</Cell>
                  <Cell>{row.upgradeClicked ? 'Yes' : 'No'}</Cell>
                  <Cell>{row.paid ? 'Yes' : 'No'}</Cell>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection title="User Activity" open={sectionsOpen.users} onToggle={() => toggleSection('users')}>
        <div className="min-w-[1120px]">
          <TableHeader columns={['Email', 'Signup', 'Source', 'Device', 'Trial', 'Searches', 'CSV', 'Email exports', 'Score', 'Last active', 'Upgrade', 'Paid']} />
          {userPageRows.map((summary) => (
            <div key={summary.user.id} className="grid grid-cols-[1.5fr_1fr_1fr_.8fr_.9fr_.6fr_.5fr_.8fr_.7fr_1fr_.7fr_.5fr] gap-3 border-t border-white/6 px-4 py-3 text-sm text-slate-300">
              <Cell>{summary.user.email}</Cell>
              <Cell>{formatDate(summary.user.created_at)}</Cell>
              <Cell>{summary.source}</Cell>
              <Cell>{summary.device}</Cell>
              <Cell>{summary.trialStatus}</Cell>
              <Cell>{summary.searches}</Cell>
              <Cell>{summary.csvDownloads}</Cell>
              <Cell>{summary.emailExports}</Cell>
              <Cell>{summary.activationScore} / {summary.activationSegment}</Cell>
              <Cell>{formatDate(summary.lastActive)}</Cell>
              <Cell>{summary.upgradeClicked ? 'Yes' : 'No'}</Cell>
              <Cell>{summary.paid ? 'Yes' : 'No'}</Cell>
            </div>
          ))}
        </div>
        <PaginationControls page={userPage} total={filteredView.users.length} onPageChange={setUserPage} />
      </CollapsibleSection>

      <CollapsibleSection title="Search Records" open={sectionsOpen.searchRows} onToggle={() => toggleSection('searchRows')}>
        <div className="min-w-[1060px]">
          <TableHeader columns={['Query', 'User email', 'Source', 'Device', 'Results', 'Emails', 'Phones', 'CSV after', 'Email after', 'Created']} />
          {searchPageRows.map((search) => {
            return (
              <div key={search.id} className="grid grid-cols-[1.5fr_1.3fr_1fr_.8fr_.6fr_.6fr_.6fr_.7fr_.7fr_1fr] gap-3 border-t border-white/6 px-4 py-3 text-sm text-slate-300">
                <Cell>{search.search_query || '-'}</Cell>
                <Cell>{search.email || '-'}</Cell>
                <Cell>{getSearchSource(search, attribution)}</Cell>
                <Cell>{search.device_type || '-'}</Cell>
                <Cell>{search.number_of_results_returned}</Cell>
                <Cell>{search.number_of_results_with_email}</Cell>
                <Cell>{search.number_of_results_with_phone}</Cell>
                <Cell>{search.downloaded_csv_after_search ? 'Yes' : 'No'}</Cell>
                <Cell>{search.email_exported_after_search ? 'Yes' : 'No'}</Cell>
                <Cell>{formatDate(search.created_at)}</Cell>
              </div>
            )
          })}
        </div>
        <PaginationControls page={searchPage} total={filteredView.searches.length} onPageChange={setSearchPage} />
      </CollapsibleSection>
    </div>
  )
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border-0 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:bg-white/[0.09]"
      />
    </label>
  )
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-h-[132px] rounded-[24px] bg-white/[0.045] p-6 shadow-[0_22px_70px_rgba(2,8,23,0.2)]">
      <div className="text-sm font-medium text-slate-400">{label}</div>
      <div className="mt-5 text-3xl font-semibold tracking-tight text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  )
}

function LeakCard({ label, rows }: { label: string; rows: UserSummary[] }) {
  return (
    <div className="rounded-[24px] bg-white/[0.045] p-5">
      <div className="text-sm font-medium text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{rows.length.toLocaleString()}</div>
      <div className="mt-3 truncate text-xs text-slate-500">
        {rows.slice(0, 3).map((row) => row.user.email).join(', ') || 'No users in this bucket'}
      </div>
    </div>
  )
}

function ExportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-950/24 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 truncate text-sm font-medium text-slate-200">{value}</div>
    </div>
  )
}

function StickyFilterBar({ children }: { children: ReactNode }) {
  return (
    <section className="sticky top-0 z-30 rounded-[24px] border border-white/8 bg-[#07111f]/95 p-4 shadow-[0_18px_60px_rgba(2,8,23,0.36)] backdrop-blur-xl">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {children}
      </div>
    </section>
  )
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="rounded-[28px] bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(2,8,23,0.18)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[44px] w-full items-center justify-between gap-4 text-left"
      >
        <h2 className="text-xl font-semibold text-white">{open ? '▼' : '▶'} {title}</h2>
      </button>
      {open ? <div className="mt-5 overflow-x-auto">{children}</div> : null}
    </section>
  )
}

function PaginationControls({
  page,
  total,
  onPageChange,
}: {
  page: number
  total: number
  onPageChange: (page: number) => void
}) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm text-slate-400">
      <span>
        {total === 0 ? '0 rows' : `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="min-h-[36px] rounded-2xl bg-white/[0.08] px-4 font-semibold text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Previous
      </button>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(maxPage, page + 1))}
        disabled={page >= maxPage}
        className="min-h-[36px] rounded-2xl bg-white/[0.08] px-4 font-semibold text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 min-h-[48px] w-full rounded-2xl border-0 bg-slate-950/24 px-4 text-sm text-white outline-none placeholder:text-slate-600 transition focus:bg-slate-950/36"
      />
    </label>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-[48px] w-full rounded-2xl border-0 bg-slate-950/24 px-4 text-sm text-white outline-none transition focus:bg-slate-950/36"
      >
        {children}
      </select>
    </label>
  )
}

function DataPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(2,8,23,0.18)]">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-5 overflow-x-auto rounded-2xl border border-white/8">{children}</div>
    </section>
  )
}

function TableHeader({ columns }: { columns: string[] }) {
  return (
    <div
      className="grid gap-3 bg-white/[0.04] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((column) => (
        <div key={column}>{column}</div>
      ))}
    </div>
  )
}

function Cell({ children }: { children: ReactNode }) {
  return <div className="min-w-0 truncate">{children}</div>
}
