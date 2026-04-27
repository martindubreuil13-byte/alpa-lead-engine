'use client'

import { useMemo, useState } from 'react'

import type { Database } from '@/lib/supabase/types'

type ActivityLogRow = Database['public']['Tables']['activity_logs']['Row']
type UserRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'email' | 'plan' | 'created_at'>

type DateRange = 'today' | '7d' | '30d'
type DashboardTab = 'users' | 'warm' | 'searches' | 'feed' | 'repeat'
type VisitorIdentity = 'Anonymous' | 'Email captured' | 'Logged in' | 'Paid'
type UsageBadge = 'Normal' | 'Repeat' | 'Heavy' | 'Possible abuse'
type IntentLevel = 'Warm' | 'Hot' | 'Very hot'

type SearchGroup = {
  key: string
  query: string
  location: string
  timesSearched: number
  leadsRequested: number
  leadsFoundTotal: number
  searchesCompleted: number
  csvDownloads: number
  emailExports: number
  upgradeClicks: number
}

type SessionSummary = {
  sessionId: string
  userId: string | null
  email: string | null
  paid: boolean
  visitorIdentity: VisitorIdentity
  firstSeen: string
  lastActivity: string
  searchesCount: number
  searchesCompleted: number
  leadsGenerated: number
  csvDownloads: number
  emailExports: number
  plansViewed: number
  upgradeClicks: number
  checkoutStarted: number
  checkoutCompleted: number
  lastQuery: string | null
  lastLocation: string | null
  usageBadge: UsageBadge
  followedUp: boolean
  note: string
  timeline: ActivityLogRow[]
}

type RepeatUsageRow = {
  visitor: string
  sessionId: string
  userId: string | null
  email: string | null
  searchesToday: number
  leadsToday: number
  totalSearches: number
  totalLeadsGenerated: number
  firstSeen: string
  lastSeen: string
  usageBadge: UsageBadge
  sessionCount: number
}

type SnapshotStats = {
  trialsStarted: number
  searchesCompleted: number
  leadsGenerated: number
  csvDownloads: number
  emailExports: number
  emailsCaptured: number
  plansViewed: number
  upgradeClicks: number
  checkoutStarted: number
  paidUsers: number
}

const RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

const TAB_OPTIONS: Array<{ value: DashboardTab; label: string }> = [
  { value: 'users', label: 'Users & Sessions' },
  { value: 'warm', label: 'Warm / Hot Leads' },
  { value: 'searches', label: 'Search Behavior' },
  { value: 'feed', label: 'Activity Feed' },
  { value: 'repeat', label: 'Repeat Usage' },
]

const FEED_EVENTS = new Set([
  'trial_started',
  'scrape_started',
  'scrape_completed',
  'csv_downloaded',
  'email_export_sent',
  'email_captured',
  'plans_viewed',
  'upgrade_clicked',
  'checkout_started',
  'checkout_completed',
])

function formatTimestamp(value: string | null) {
  if (!value) return 'Unknown'

  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function shortenSessionId(value: string | null) {
  const normalized = String(value || '').trim()
  if (!normalized) return 'unknown'
  return normalized.slice(0, 8)
}

function normalizeText(value: string | null | undefined) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function normalizeEmail(value: string | null | undefined) {
  return normalizeText(value)?.toLowerCase() ?? null
}

function getRangeStart(range: DateRange) {
  const now = new Date()

  if (range === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start
  }

  const start = new Date(now)
  start.setDate(start.getDate() - (range === '7d' ? 7 : 30))
  return start
}

function getTodayStart() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start
}

function parseMetadataObject(value: ActivityLogRow['metadata']) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getMetadataNumber(log: ActivityLogRow, key: string) {
  const metadata = parseMetadataObject(log.metadata)
  const raw = metadata?.[key]
  const number = Number(raw)
  return Number.isFinite(number) ? number : 0
}

function getMetadataBoolean(log: ActivityLogRow, key: string) {
  const metadata = parseMetadataObject(log.metadata)
  return metadata?.[key] === true
}

function getMetadataString(log: ActivityLogRow, key: string) {
  const metadata = parseMetadataObject(log.metadata)
  return normalizeText(typeof metadata?.[key] === 'string' ? String(metadata[key]) : null)
}

function eventLabel(event: string) {
  return event.replace(/_/g, ' ')
}

function visitorIdentityLabel(paid: boolean, userId: string | null, email: string | null): VisitorIdentity {
  if (paid) return 'Paid'
  if (userId) return 'Logged in'
  if (email) return 'Email captured'
  return 'Anonymous'
}

function badgeTone(badge: UsageBadge) {
  switch (badge) {
    case 'Possible abuse':
      return 'border-rose-400/25 bg-rose-500/10 text-rose-200'
    case 'Heavy':
      return 'border-amber-300/25 bg-amber-400/10 text-amber-100'
    case 'Repeat':
      return 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100'
    default:
      return 'border-white/10 bg-white/[0.04] text-slate-300'
  }
}

function intentTone(level: IntentLevel) {
  switch (level) {
    case 'Very hot':
      return 'border-rose-400/25 bg-rose-500/10 text-rose-200'
    case 'Hot':
      return 'border-amber-300/25 bg-amber-400/10 text-amber-100'
    default:
      return 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100'
  }
}

function inferUsageBadge(params: {
  searchesToday: number
  leadsToday: number
  totalLeads: number
  sessionCount: number
  email: string | null
  userId: string | null
}): UsageBadge {
  if (params.totalLeads >= 75 || (params.email && !params.userId && params.sessionCount > 1)) {
    return 'Possible abuse'
  }
  if (params.leadsToday >= 50) {
    return 'Heavy'
  }
  if (params.searchesToday >= 2 || params.sessionCount > 1) {
    return 'Repeat'
  }
  return 'Normal'
}

function buildFollowUpMessage(session: SessionSummary) {
  const query = normalizeText(session.lastQuery)
  const location = normalizeText(session.lastLocation)

  let detailLine = 'Saw you tested ALPA and generated a lead list.'
  if (query && location) {
    detailLine = `Saw you tested ALPA and generated leads for "${query}" in "${location}".`
  } else if (query) {
    detailLine = `Saw you tested ALPA and generated leads for "${query}".`
  } else if (location) {
    detailLine = `Saw you tested ALPA and generated leads in "${location}".`
  }

  return [
    'Hi,',
    '',
    detailLine,
    '',
    'Curious — were the leads useful for your market?',
    '',
    'If you want to keep using it, the Starter plan gives you 300 leads/month for $29.99.',
    '',
    'Martin',
  ].join('\n')
}

function exportCsv(rows: Array<Record<string, string | number | boolean | null>>) {
  if (rows.length === 0) {
    return ''
  }

  const headers = Object.keys(rows[0]!)
  const escape = (value: string | number | boolean | null) => {
    const raw = value == null ? '' : String(value)
    return `"${raw.replace(/"/g, '""')}"`
  }

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header] ?? '')).join(',')),
  ].join('\n')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function groupData(logs: ActivityLogRow[], users: UserRow[], range: DateRange) {
  const rangeStart = getRangeStart(range)
  const todayStart = getTodayStart()
  const usersById = new Map(users.map((user) => [user.id, user]))
  const filteredLogs = logs.filter((log) => new Date(log.created_at) >= rangeStart)
  const allLogsAsc = [...logs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  const logsAsc = [...filteredLogs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  const sessionMap = new Map<
    string,
    {
      sessionId: string
      userId: string | null
      email: string | null
      paid: boolean
      firstSeen: string
      lastActivity: string
      searchesStarted: number
      searchesCompleted: number
      leadsGenerated: number
      csvDownloads: number
      emailExports: number
      plansViewed: number
      upgradeClicks: number
      checkoutStarted: number
      checkoutCompleted: number
      lastQuery: string | null
      lastLocation: string | null
      followedUp: boolean
      note: string
      timeline: ActivityLogRow[]
      searchesToday: number
      leadsToday: number
    }
  >()

  const searchMap = new Map<string, SearchGroup>()
  const lastSearchKeyBySession = new Map<string, string>()

  for (const log of logsAsc) {
    const sessionId = normalizeText(log.session_id) || 'unknown'
    const existingSession = sessionMap.get(sessionId)

    if (log.event === 'admin_followup_updated' && !existingSession) {
      continue
    }

    const user = log.user_id ? usersById.get(log.user_id) : null
    const normalizedUserId = normalizeText(log.user_id)
    const normalizedEmail = normalizeEmail(log.email) || normalizeEmail(user?.email)
    const paid = (user?.plan && user.plan !== 'free') || log.event === 'checkout_completed'

    const session =
      existingSession ??
      {
        sessionId,
        userId: normalizedUserId,
        email: normalizedEmail,
        paid: Boolean(paid),
        firstSeen: log.created_at,
        lastActivity: log.created_at,
        searchesStarted: 0,
        searchesCompleted: 0,
        leadsGenerated: 0,
        csvDownloads: 0,
        emailExports: 0,
        plansViewed: 0,
        upgradeClicks: 0,
        checkoutStarted: 0,
        checkoutCompleted: 0,
        lastQuery: null,
        lastLocation: null,
        followedUp: false,
        note: '',
        timeline: [],
        searchesToday: 0,
        leadsToday: 0,
      }

    session.userId = session.userId || normalizedUserId
    session.email = session.email || normalizedEmail
    session.paid = session.paid || Boolean(paid)
    session.lastActivity = log.created_at
    session.timeline.push(log)

    if (log.query) {
      session.lastQuery = log.query
    }
    if (log.location) {
      session.lastLocation = log.location
    }

    const isToday = new Date(log.created_at) >= todayStart
    const compositeSearchKey = `${normalizeText(log.query) || 'Unknown'}||${normalizeText(log.location) || 'Unknown'}`

    if (log.event === 'scrape_started') {
      session.searchesStarted += 1
      if (isToday) {
        session.searchesToday += 1
      }

      const group = searchMap.get(compositeSearchKey) ?? {
        key: compositeSearchKey,
        query: normalizeText(log.query) || 'Unknown',
        location: normalizeText(log.location) || 'Unknown',
        timesSearched: 0,
        leadsRequested: 0,
        leadsFoundTotal: 0,
        searchesCompleted: 0,
        csvDownloads: 0,
        emailExports: 0,
        upgradeClicks: 0,
      }
      group.timesSearched += 1
      group.leadsRequested += getMetadataNumber(log, 'target')
      searchMap.set(compositeSearchKey, group)
      lastSearchKeyBySession.set(sessionId, compositeSearchKey)
    }

    if (log.event === 'scrape_completed') {
      session.searchesCompleted += 1
      session.leadsGenerated += log.leads_count ?? 0
      if (isToday) {
        session.leadsToday += log.leads_count ?? 0
      }

      const group = searchMap.get(compositeSearchKey) ?? {
        key: compositeSearchKey,
        query: normalizeText(log.query) || 'Unknown',
        location: normalizeText(log.location) || 'Unknown',
        timesSearched: 0,
        leadsRequested: 0,
        leadsFoundTotal: 0,
        searchesCompleted: 0,
        csvDownloads: 0,
        emailExports: 0,
        upgradeClicks: 0,
      }
      group.searchesCompleted += 1
      group.leadsFoundTotal += log.leads_count ?? 0
      searchMap.set(compositeSearchKey, group)
      lastSearchKeyBySession.set(sessionId, compositeSearchKey)
    }

    if (log.event === 'csv_downloaded') {
      session.csvDownloads += 1
      const activeSearchKey = lastSearchKeyBySession.get(sessionId)
      if (activeSearchKey && searchMap.has(activeSearchKey)) {
        searchMap.get(activeSearchKey)!.csvDownloads += 1
      }
    }

    if (log.event === 'email_export_sent') {
      session.emailExports += 1
      const activeSearchKey = lastSearchKeyBySession.get(sessionId)
      if (activeSearchKey && searchMap.has(activeSearchKey)) {
        searchMap.get(activeSearchKey)!.emailExports += 1
      }
    }

    if (log.event === 'plans_viewed') {
      session.plansViewed += 1
    }

    if (log.event === 'upgrade_clicked') {
      session.upgradeClicks += 1
      const activeSearchKey = lastSearchKeyBySession.get(sessionId)
      if (activeSearchKey && searchMap.has(activeSearchKey)) {
        searchMap.get(activeSearchKey)!.upgradeClicks += 1
      }
    }

    if (log.event === 'checkout_started') {
      session.checkoutStarted += 1
    }

    if (log.event === 'checkout_completed') {
      session.checkoutCompleted += 1
      session.paid = true
    }

    if (log.event === 'admin_followup_updated') {
      const nextFollowedUp = getMetadataBoolean(log, 'followed_up')
      const nextNote = getMetadataString(log, 'note')
      session.followedUp = nextFollowedUp
      session.note = nextNote || ''
    }

    sessionMap.set(sessionId, session)
  }

  for (const log of allLogsAsc) {
    if (log.event !== 'admin_followup_updated') continue

    const sessionId = normalizeText(log.session_id) || 'unknown'
    const session = sessionMap.get(sessionId)
    if (!session) continue

    session.followedUp = getMetadataBoolean(log, 'followed_up')
    session.note = getMetadataString(log, 'note') || ''
  }

  const identityMap = new Map<
    string,
    {
      sessionIds: Set<string>
      userId: string | null
      email: string | null
      firstSeen: string
      lastSeen: string
      totalSearches: number
      totalLeads: number
      searchesToday: number
      leadsToday: number
    }
  >()

  for (const session of sessionMap.values()) {
    const identityKey =
      session.userId || (session.email ? `email:${session.email}` : `session:${session.sessionId}`)

    const identity =
      identityMap.get(identityKey) ??
      {
        sessionIds: new Set<string>(),
        userId: session.userId,
        email: session.email,
        firstSeen: session.firstSeen,
        lastSeen: session.lastActivity,
        totalSearches: 0,
        totalLeads: 0,
        searchesToday: 0,
        leadsToday: 0,
      }

    identity.sessionIds.add(session.sessionId)
    identity.userId = identity.userId || session.userId
    identity.email = identity.email || session.email
    identity.totalSearches += Math.max(session.searchesStarted, session.searchesCompleted)
    identity.totalLeads += session.leadsGenerated
    identity.searchesToday += session.searchesToday
    identity.leadsToday += session.leadsToday

    if (new Date(session.firstSeen) < new Date(identity.firstSeen)) {
      identity.firstSeen = session.firstSeen
    }
    if (new Date(session.lastActivity) > new Date(identity.lastSeen)) {
      identity.lastSeen = session.lastActivity
    }

    identityMap.set(identityKey, identity)
  }

  const sessionRows: SessionSummary[] = [...sessionMap.values()]
    .map((session) => {
      const identityKey =
        session.userId || (session.email ? `email:${session.email}` : `session:${session.sessionId}`)
      const identity = identityMap.get(identityKey)
      const usageBadge = inferUsageBadge({
        searchesToday: identity?.searchesToday ?? session.searchesToday,
        leadsToday: identity?.leadsToday ?? session.leadsToday,
        totalLeads: identity?.totalLeads ?? session.leadsGenerated,
        sessionCount: identity?.sessionIds.size ?? 1,
        email: session.email,
        userId: session.userId,
      })

      return {
        sessionId: session.sessionId,
        userId: session.userId,
        email: session.email,
        paid: session.paid,
        visitorIdentity: visitorIdentityLabel(session.paid, session.userId, session.email),
        firstSeen: session.firstSeen,
        lastActivity: session.lastActivity,
        searchesCount: Math.max(session.searchesStarted, session.searchesCompleted),
        searchesCompleted: session.searchesCompleted,
        leadsGenerated: session.leadsGenerated,
        csvDownloads: session.csvDownloads,
        emailExports: session.emailExports,
        plansViewed: session.plansViewed,
        upgradeClicks: session.upgradeClicks,
        checkoutStarted: session.checkoutStarted,
        checkoutCompleted: session.checkoutCompleted,
        lastQuery: session.lastQuery,
        lastLocation: session.lastLocation,
        usageBadge,
        followedUp: session.followedUp,
        note: session.note,
        timeline: [...session.timeline].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
      }
    })
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())

  const warmRows = sessionRows
    .filter((session) => {
      return Boolean(
        session.email ||
          session.csvDownloads > 0 ||
          session.emailExports > 0 ||
          session.plansViewed > 0 ||
          session.upgradeClicks > 0 ||
          session.checkoutStarted > 0 ||
          session.searchesCount > 1
      )
    })
    .map((session) => {
      let intentLevel: IntentLevel = 'Warm'
      if (session.checkoutStarted > 0 && !session.paid) {
        intentLevel = 'Very hot'
      } else if (session.plansViewed > 0 || session.upgradeClicks > 0) {
        intentLevel = 'Hot'
      }

      let trigger = 'Email captured'
      if (session.checkoutStarted > 0 && !session.paid) {
        trigger = 'Checkout'
      } else if (session.upgradeClicks > 0) {
        trigger = 'Upgrade'
      } else if (session.plansViewed > 0) {
        trigger = 'Plans viewed'
      } else if (session.emailExports > 0) {
        trigger = 'Email export'
      } else if (session.csvDownloads > 0) {
        trigger = 'CSV'
      } else if (session.searchesCount > 1) {
        trigger = 'Repeat search'
      }

      return {
        ...session,
        intentLevel,
        trigger,
      }
    })

  const repeatRows: RepeatUsageRow[] = [...identityMap.entries()]
    .map(([identityKey, identity]) => {
      const firstSessionId = [...identity.sessionIds][0] ?? identityKey
      const badge = inferUsageBadge({
        searchesToday: identity.searchesToday,
        leadsToday: identity.leadsToday,
        totalLeads: identity.totalLeads,
        sessionCount: identity.sessionIds.size,
        email: identity.email,
        userId: identity.userId,
      })
      const visitor =
        identity.userId || identity.email || shortenSessionId(firstSessionId)

      return {
        visitor,
        sessionId: firstSessionId,
        userId: identity.userId,
        email: identity.email,
        searchesToday: identity.searchesToday,
        leadsToday: identity.leadsToday,
        totalSearches: identity.totalSearches,
        totalLeadsGenerated: identity.totalLeads,
        firstSeen: identity.firstSeen,
        lastSeen: identity.lastSeen,
        usageBadge: badge,
        sessionCount: identity.sessionIds.size,
      }
    })
    .filter((row) => row.totalSearches > 0 || row.totalLeadsGenerated > 0 || row.email)
    .sort((a, b) => {
      const severity = ['Normal', 'Repeat', 'Heavy', 'Possible abuse']
      return (
        severity.indexOf(b.usageBadge) - severity.indexOf(a.usageBadge) ||
        new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
      )
    })

  const snapshot: SnapshotStats = {
    trialsStarted: filteredLogs.filter((log) => log.event === 'trial_started').length,
    searchesCompleted: filteredLogs.filter((log) => log.event === 'scrape_completed').length,
    leadsGenerated: filteredLogs
      .filter((log) => log.event === 'scrape_completed')
      .reduce((sum, log) => sum + (log.leads_count ?? 0), 0),
    csvDownloads: filteredLogs.filter((log) => log.event === 'csv_downloaded').length,
    emailExports: filteredLogs.filter((log) => log.event === 'email_export_sent').length,
    emailsCaptured: new Set(
      filteredLogs
        .filter((log) => log.event === 'email_captured')
        .map((log) => normalizeEmail(log.email) || log.session_id)
        .filter(Boolean)
    ).size,
    plansViewed: filteredLogs.filter((log) => log.event === 'plans_viewed').length,
    upgradeClicks: filteredLogs.filter((log) => log.event === 'upgrade_clicked').length,
    checkoutStarted: filteredLogs.filter((log) => log.event === 'checkout_started').length,
    paidUsers: new Set(
      filteredLogs
        .filter((log) => log.event === 'checkout_completed')
        .map((log) => normalizeText(log.user_id) || normalizeEmail(log.email) || log.session_id)
        .filter(Boolean)
    ).size,
  }

  const feedRows = filteredLogs
    .filter((log) => FEED_EVENTS.has(log.event))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 250)
    .map((log) => {
      const user = log.user_id ? usersById.get(log.user_id) : null
      const email = normalizeEmail(log.email) || normalizeEmail(user?.email)
      const paid = Boolean(user?.plan && user.plan !== 'free') || log.event === 'checkout_completed'
      return {
        ...log,
        email,
        visitorIdentity: visitorIdentityLabel(paid, normalizeText(log.user_id), email),
      }
    })

  const searchRows = [...searchMap.values()]
    .filter((row) => row.timesSearched > 0 || row.searchesCompleted > 0)
    .sort((a, b) => b.timesSearched - a.timesSearched || b.upgradeClicks - a.upgradeClicks)

  return {
    snapshot,
    sessionRows,
    warmRows,
    searchRows,
    feedRows,
    repeatRows,
  }
}

async function copyToClipboard(value: string) {
  if (!value) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export default function AdminGrowthDashboard({
  initialLogs,
  users,
}: {
  initialLogs: ActivityLogRow[]
  users: UserRow[]
}) {
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [activeTab, setActiveTab] = useState<DashboardTab>('users')
  const [logs, setLogs] = useState<ActivityLogRow[]>(initialLogs)
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteTarget, setNoteTarget] = useState<SessionSummary | null>(null)
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null)
  const [bannerMessage, setBannerMessage] = useState<string | null>(null)

  const data = useMemo(() => groupData(logs, users, dateRange), [dateRange, logs, users])

  async function updateFollowUp(session: SessionSummary, payload: { followedUp: boolean; note: string }) {
    setSavingSessionId(session.sessionId)

    try {
      const res = await fetch('/api/admin/activity-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          userId: session.userId,
          email: session.email,
          followedUp: payload.followedUp,
          note: payload.note,
        }),
      })

      const response = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(response?.error || 'Unable to save follow-up state')
      }

      const nextLog: ActivityLogRow = {
        id: crypto.randomUUID(),
        session_id: session.sessionId,
        user_id: session.userId,
        email: session.email,
        event: 'admin_followup_updated',
        query: session.lastQuery,
        location: session.lastLocation,
        leads_count: session.leadsGenerated,
        metadata: {
          followed_up: payload.followedUp,
          note: payload.note,
        },
        created_at: new Date().toISOString(),
      }

      setLogs((prev) => [...prev, nextLog])
      setBannerMessage(payload.followedUp ? 'Marked followed up.' : 'Follow-up cleared.')
    } catch (error) {
      setBannerMessage(error instanceof Error ? error.message : 'Unable to save follow-up state.')
    } finally {
      setSavingSessionId(null)
    }
  }

  async function handleCopyFollowUp(session: SessionSummary) {
    const ok = await copyToClipboard(buildFollowUpMessage(session))
    setBannerMessage(ok ? 'Follow-up message copied.' : 'Could not copy follow-up message.')
  }

  async function handleCopyEmail(email: string | null) {
    if (!email) {
      setBannerMessage('No email captured for this visitor.')
      return
    }
    const ok = await copyToClipboard(email)
    setBannerMessage(ok ? 'Email copied.' : 'Could not copy email.')
  }

  function handleExportWarmLeads() {
    const rows = data.warmRows.map((row) => ({
      Email: row.email,
      'Session ID': row.sessionId,
      'User ID': row.userId,
      'Last activity': row.lastActivity,
      'Last query': row.lastQuery,
      'Last location': row.lastLocation,
      'Leads generated': row.leadsGenerated,
      'CSV downloads': row.csvDownloads,
      'Email exports': row.emailExports,
      'Plans viewed': row.plansViewed,
      'Upgrade clicks': row.upgradeClicks,
      'Checkout started': row.checkoutStarted,
      Paid: row.paid ? 'Yes' : 'No',
      'Intent level': row.intentLevel,
      Trigger: row.trigger,
      'Followed up': row.followedUp ? 'Yes' : 'No',
      Notes: row.note,
    }))

    if (rows.length === 0) {
      setBannerMessage('No warm leads available to export.')
      return
    }

    downloadCsv('alpa-warm-leads.csv', exportCsv(rows))
    setBannerMessage('Warm leads CSV exported.')
  }

  return (
    <div className="space-y-6">
      <header className="glass p-5 sm:p-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/80">
          Admin
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Growth Dashboard
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Product usage, conversion intent, and repeat free-trial behavior inside ALPA.
        </p>
      </header>

      <section className="glass p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setDateRange(option.value)}
              className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                dateRange === option.value
                  ? 'border border-cyan-300/25 bg-cyan-400/10 text-cyan-100'
                  : 'border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          ['Trials Started', data.snapshot.trialsStarted],
          ['Searches Completed', data.snapshot.searchesCompleted],
          ['Leads Generated', data.snapshot.leadsGenerated],
          ['CSV Downloads', data.snapshot.csvDownloads],
          ['Email Exports', data.snapshot.emailExports],
          ['Emails Captured', data.snapshot.emailsCaptured],
          ['Plans Viewed', data.snapshot.plansViewed],
          ['Upgrade Clicks', data.snapshot.upgradeClicks],
          ['Checkout Started', data.snapshot.checkoutStarted],
          ['Paid Users', data.snapshot.paidUsers],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-[24px] border border-white/10 bg-[#08111f]/90 p-4 shadow-[0_20px_60px_rgba(2,8,23,0.28)]"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {label}
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight text-white">
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="glass p-3 sm:p-4">
        <div className="flex flex-wrap gap-2">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                activeTab === tab.value
                  ? 'border border-cyan-300/25 bg-cyan-400/10 text-cyan-100'
                  : 'border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {bannerMessage ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          {bannerMessage}
        </div>
      ) : null}

      {activeTab === 'users' ? (
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_24px_80px_rgba(2,8,23,0.32)]">
          <div className="overflow-x-auto">
            <table className="min-w-[1500px] text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                  <th className="px-4 py-3 font-medium">Visitor</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Session ID</th>
                  <th className="px-4 py-3 font-medium">User ID</th>
                  <th className="px-4 py-3 font-medium">First seen</th>
                  <th className="px-4 py-3 font-medium">Searches</th>
                  <th className="px-4 py-3 font-medium">Leads</th>
                  <th className="px-4 py-3 font-medium">CSV</th>
                  <th className="px-4 py-3 font-medium">Email exports</th>
                  <th className="px-4 py-3 font-medium">Plans</th>
                  <th className="px-4 py-3 font-medium">Upgrade</th>
                  <th className="px-4 py-3 font-medium">Checkout</th>
                  <th className="px-4 py-3 font-medium">Paid</th>
                  <th className="px-4 py-3 font-medium">Usage</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.sessionRows.map((row) => (
                  <tr key={row.sessionId} className="border-t border-white/6 align-top">
                    <td className="px-4 py-3 text-slate-400">{formatTimestamp(row.lastActivity)}</td>
                    <td className="px-4 py-3 text-white">{row.visitorIdentity}</td>
                    <td className="px-4 py-3">{row.email || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {shortenSessionId(row.sessionId)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.userId ? shortenSessionId(row.userId) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{formatTimestamp(row.firstSeen)}</td>
                    <td className="px-4 py-3">{row.searchesCount}</td>
                    <td className="px-4 py-3">{row.leadsGenerated}</td>
                    <td className="px-4 py-3">{row.csvDownloads}</td>
                    <td className="px-4 py-3">{row.emailExports}</td>
                    <td className="px-4 py-3">{row.plansViewed}</td>
                    <td className="px-4 py-3">{row.upgradeClicks}</td>
                    <td className="px-4 py-3">{row.checkoutStarted}</td>
                    <td className="px-4 py-3">{row.paid ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${badgeTone(row.usageBadge)}`}>
                        {row.usageBadge}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSession(row)}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:text-white"
                        >
                          View timeline
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopyEmail(row.email)}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:text-white"
                        >
                          Copy email
                        </button>
                        <button
                          type="button"
                          disabled={savingSessionId === row.sessionId}
                          onClick={() =>
                            void updateFollowUp(row, {
                              followedUp: !row.followedUp,
                              note: row.note,
                            })
                          }
                          className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:text-white disabled:opacity-50"
                        >
                          {row.followedUp ? 'Followed up' : 'Mark followed up'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNoteDraft(row.note)
                            setNoteTarget(row)
                          }}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:text-white"
                        >
                          Add note
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'warm' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-400">
              Visitors showing real product intent or repeat free usage.
            </div>
            <button
              type="button"
              onClick={handleExportWarmLeads}
              className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:text-white"
            >
              Export Warm Leads CSV
            </button>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_24px_80px_rgba(2,8,23,0.32)]">
            <div className="overflow-x-auto">
              <table className="min-w-[1400px] text-left text-sm text-slate-300">
                <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Visitor</th>
                    <th className="px-4 py-3 font-medium">Last activity</th>
                    <th className="px-4 py-3 font-medium">Last query</th>
                    <th className="px-4 py-3 font-medium">Last location</th>
                    <th className="px-4 py-3 font-medium">Leads</th>
                    <th className="px-4 py-3 font-medium">Intent</th>
                    <th className="px-4 py-3 font-medium">Trigger</th>
                    <th className="px-4 py-3 font-medium">Followed up</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.warmRows.map((row) => (
                    <tr key={row.sessionId} className="border-t border-white/6 align-top">
                      <td className="px-4 py-3">{row.email || '—'}</td>
                      <td className="px-4 py-3 text-white">{row.visitorIdentity}</td>
                      <td className="px-4 py-3 text-slate-400">{formatTimestamp(row.lastActivity)}</td>
                      <td className="px-4 py-3">{row.lastQuery || '—'}</td>
                      <td className="px-4 py-3">{row.lastLocation || '—'}</td>
                      <td className="px-4 py-3">{row.leadsGenerated}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${intentTone(row.intentLevel)}`}>
                          {row.intentLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3">{row.trigger}</td>
                      <td className="px-4 py-3">{row.followedUp ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3 text-slate-400">{row.note || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCopyFollowUp(row)}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:text-white"
                          >
                            Copy follow-up message
                          </button>
                          <button
                            type="button"
                            disabled={savingSessionId === row.sessionId}
                            onClick={() =>
                              void updateFollowUp(row, {
                                followedUp: !row.followedUp,
                                note: row.note,
                              })
                            }
                            className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:text-white disabled:opacity-50"
                          >
                            {row.followedUp ? 'Followed up' : 'Mark followed up'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNoteDraft(row.note)
                              setNoteTarget(row)
                            }}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:text-white"
                          >
                            Add note
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'searches' ? (
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_24px_80px_rgba(2,8,23,0.32)]">
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Query</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Times searched</th>
                  <th className="px-4 py-3 font-medium">Leads requested</th>
                  <th className="px-4 py-3 font-medium">Average leads found</th>
                  <th className="px-4 py-3 font-medium">Searches completed</th>
                  <th className="px-4 py-3 font-medium">CSV downloads</th>
                  <th className="px-4 py-3 font-medium">Email exports</th>
                  <th className="px-4 py-3 font-medium">Upgrade clicks</th>
                </tr>
              </thead>
              <tbody>
                {data.searchRows.map((row) => (
                  <tr key={row.key} className="border-t border-white/6">
                    <td className="px-4 py-3 text-white">{row.query}</td>
                    <td className="px-4 py-3">{row.location}</td>
                    <td className="px-4 py-3">{row.timesSearched}</td>
                    <td className="px-4 py-3">{row.leadsRequested}</td>
                    <td className="px-4 py-3">
                      {row.searchesCompleted > 0
                        ? (row.leadsFoundTotal / row.searchesCompleted).toFixed(1)
                        : '0.0'}
                    </td>
                    <td className="px-4 py-3">{row.searchesCompleted}</td>
                    <td className="px-4 py-3">{row.csvDownloads}</td>
                    <td className="px-4 py-3">{row.emailExports}</td>
                    <td className="px-4 py-3">{row.upgradeClicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'feed' ? (
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_24px_80px_rgba(2,8,23,0.32)]">
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Visitor</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Query</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Leads</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Session ID</th>
                  <th className="px-4 py-3 font-medium">User ID</th>
                </tr>
              </thead>
              <tbody>
                {data.feedRows.map((row, index) => (
                  <tr key={`${row.id}-${index}`} className="border-t border-white/6">
                    <td className="px-4 py-3 text-slate-400">{formatTimestamp(row.created_at)}</td>
                    <td className="px-4 py-3 text-white">{row.visitorIdentity}</td>
                    <td className="px-4 py-3">{eventLabel(row.event)}</td>
                    <td className="px-4 py-3">{row.query || '—'}</td>
                    <td className="px-4 py-3">{row.location || '—'}</td>
                    <td className="px-4 py-3">{row.leads_count ?? '—'}</td>
                    <td className="px-4 py-3">{row.email || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {shortenSessionId(row.session_id)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.user_id ? shortenSessionId(row.user_id) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'repeat' ? (
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_24px_80px_rgba(2,8,23,0.32)]">
          <div className="overflow-x-auto">
            <table className="min-w-[1300px] text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Visitor</th>
                  <th className="px-4 py-3 font-medium">Session ID</th>
                  <th className="px-4 py-3 font-medium">User ID</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Searches today</th>
                  <th className="px-4 py-3 font-medium">Leads today</th>
                  <th className="px-4 py-3 font-medium">Total searches</th>
                  <th className="px-4 py-3 font-medium">Total leads</th>
                  <th className="px-4 py-3 font-medium">First seen</th>
                  <th className="px-4 py-3 font-medium">Last seen</th>
                  <th className="px-4 py-3 font-medium">Usage</th>
                </tr>
              </thead>
              <tbody>
                {data.repeatRows.map((row) => (
                  <tr key={`${row.sessionId}-${row.visitor}`} className="border-t border-white/6">
                    <td className="px-4 py-3 text-white">{row.visitor}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {shortenSessionId(row.sessionId)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.userId ? shortenSessionId(row.userId) : '—'}
                    </td>
                    <td className="px-4 py-3">{row.email || '—'}</td>
                    <td className="px-4 py-3">{row.searchesToday}</td>
                    <td className="px-4 py-3">{row.leadsToday}</td>
                    <td className="px-4 py-3">{row.totalSearches}</td>
                    <td className="px-4 py-3">{row.totalLeadsGenerated}</td>
                    <td className="px-4 py-3 text-slate-400">{formatTimestamp(row.firstSeen)}</td>
                    <td className="px-4 py-3 text-slate-400">{formatTimestamp(row.lastSeen)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${badgeTone(row.usageBadge)}`}>
                        {row.usageBadge}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {selectedSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#08111f] p-6 shadow-[0_30px_100px_rgba(2,8,23,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-white">Session timeline</h2>
                <p className="mt-2 text-sm text-slate-400">
                  {selectedSession.email || selectedSession.visitorIdentity} · {shortenSessionId(selectedSession.sessionId)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSession(null)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300 transition hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-6 max-h-[60vh] space-y-3 overflow-y-auto pr-2">
              {selectedSession.timeline.map((log, index) => (
                <div
                  key={`${log.id}-${index}`}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-medium text-white">{eventLabel(log.event)}</div>
                    <div className="text-xs text-slate-500">{formatTimestamp(log.created_at)}</div>
                  </div>
                  <div className="mt-2 grid gap-2 text-sm text-slate-400 sm:grid-cols-4">
                    <div>Query: {log.query || '—'}</div>
                    <div>Location: {log.location || '—'}</div>
                    <div>Leads: {log.leads_count ?? '—'}</div>
                    <div>Email: {log.email || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {noteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#08111f] p-6 shadow-[0_30px_100px_rgba(2,8,23,0.55)]">
            <h2 className="text-2xl font-semibold text-white">Add note</h2>
            <p className="mt-2 text-sm text-slate-400">
              {noteTarget.email || noteTarget.visitorIdentity} · {shortenSessionId(noteTarget.sessionId)}
            </p>

            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={6}
              className="mt-5 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
              placeholder="Add a follow-up note..."
            />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setNoteTarget(null)
                  setNoteDraft('')
                }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingSessionId === noteTarget.sessionId}
                onClick={async () => {
                  await updateFollowUp(noteTarget, {
                    followedUp: noteTarget.followedUp,
                    note: noteDraft,
                  })
                  setNoteTarget(null)
                  setNoteDraft('')
                }}
                className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:text-white disabled:opacity-50"
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
