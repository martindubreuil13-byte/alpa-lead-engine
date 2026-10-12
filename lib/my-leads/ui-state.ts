// The workspace's view state, as plain functions: what the filters are, how they travel in the URL and to the endpoint, how a
// selection spans pages, and how a row's status and age are worded. Pure, so it is tested without a browser.

import type { LeadProfileState } from '../intelligence/run-progress.ts'
import { BI_FILTERS, CONTACT_KEYS, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, SORT_KEYS, type BiFilter, type ContactKey, type SortKey } from './params.ts'

export type WorkspaceView = 'active' | 'archived'

export type FilterState = {
  q: string
  city: string
  industry: string
  contact: ContactKey[]
  bi: BiFilter | ''
  sort: SortKey
  view: WorkspaceView
  page: number
  pageSize: number
}

export const DEFAULT_FILTERS: FilterState = { q: '', city: '', industry: '', contact: [], bi: '', sort: 'activity', view: 'active', page: 1, pageSize: PAGE_SIZE_DEFAULT }
export const PAGE_SIZES = [25, 50] as const

/** Reads filters from a URL's query string. Anything unknown or malformed falls back to its default; it never throws. */
export function filtersFromSearch(search: URLSearchParams | string): FilterState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null => (value && (allowed as readonly string[]).includes(value) ? (value as T) : null)
  const number = (value: string | null, fallback: number, max: number) => (value && /^\d{1,6}$/.test(value) && Number(value) >= 1 ? Math.min(Number(value), max) : fallback)
  const contact = [...new Set((params.get('contact') ?? '').split(',').filter((part): part is ContactKey => (CONTACT_KEYS as readonly string[]).includes(part)))]
  return {
    q: (params.get('q') ?? '').slice(0, 100),
    city: (params.get('city') ?? '').slice(0, 80),
    industry: (params.get('industry') ?? '').slice(0, 80),
    contact,
    bi: pick(params.get('bi'), BI_FILTERS) ?? '',
    sort: pick(params.get('sort'), SORT_KEYS) ?? DEFAULT_FILTERS.sort,
    view: params.get('view') === 'archived' ? 'archived' : 'active',
    page: number(params.get('page'), 1, 100_000),
    pageSize: Math.min(number(params.get('pageSize'), DEFAULT_FILTERS.pageSize, PAGE_SIZE_MAX), PAGE_SIZE_MAX),
  }
}

/** The query string for both the address bar and the endpoint. Defaults are omitted, so a clean workspace has a clean URL. */
export function filtersToSearch(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (filters.city.trim()) params.set('city', filters.city.trim())
  if (filters.industry.trim()) params.set('industry', filters.industry.trim())
  if (filters.contact.length) params.set('contact', filters.contact.join(','))
  if (filters.bi) params.set('bi', filters.bi)
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort)
  if (filters.view !== DEFAULT_FILTERS.view) params.set('view', filters.view)
  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.pageSize !== DEFAULT_FILTERS.pageSize) params.set('pageSize', String(filters.pageSize))
  return params
}

export const sameFilters = (a: FilterState, b: FilterState) => filtersToSearch(a).toString() === filtersToSearch(b).toString()

/** Whether anything narrows the list (the view, the sort and the page do not count). */
export function hasActiveFilters(filters: FilterState): boolean {
  return Boolean(filters.q.trim() || filters.city.trim() || filters.industry.trim() || filters.contact.length || filters.bi)
}

export function describeRange(input: { page: number; pageSize: number; count: number; total: number }): string {
  if (input.total === 0 || input.count === 0) return 'No businesses'
  const from = (input.page - 1) * input.pageSize + 1
  const to = from + input.count - 1
  return `${from.toLocaleString('en')}–${to.toLocaleString('en')} of ${input.total.toLocaleString('en')}`
}

// ---------------------------------------------------------------------------------------------------------------- selection
export const toggleId = (selected: string[], id: string): string[] => (selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id])
export const selectIds = (selected: string[], ids: string[]): string[] => [...new Set([...selected, ...ids])]
export const deselectIds = (selected: string[], ids: string[]): string[] => selected.filter((entry) => !ids.includes(entry))
export const allSelected = (selected: string[], ids: string[]): boolean => ids.length > 0 && ids.every((id) => selected.includes(id))

// ---------------------------------------------------------------------------------------------------------------------- words
export type ChipTone = 'ready' | 'working' | 'waiting' | 'attention' | 'quiet'

/** The short status each saved business shows. Worded from the real state only; nothing is promised. */
export const STATUS_CHIP: Record<LeadProfileState, { label: string; tone: ChipTone }> = {
  ready: { label: 'Profile ready', tone: 'ready' },
  researching: { label: 'Researching', tone: 'working' },
  queued: { label: 'Queued', tone: 'waiting' },
  retry_pending: { label: 'Retrying', tone: 'working' },
  failed: { label: 'Needs attention', tone: 'attention' },
  partial: { label: 'Needs attention', tone: 'attention' },
  unavailable: { label: 'No profile', tone: 'quiet' },
  cancelled: { label: 'Stopped', tone: 'quiet' },
  not_started: { label: 'Not generated', tone: 'quiet' },
}

export const BI_FILTER_LABEL: Record<BiFilter | '', string> = {
  '': 'Any status',
  ready: 'Profile ready',
  not_ready: 'No profile yet',
  awaiting: 'Awaiting intelligence',
  attention: 'Needs attention',
}

export const SORT_LABEL: Record<SortKey, string> = {
  activity: 'Recent activity',
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name A–Z',
  location: 'Location',
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 d ago", then the date. Unknown dates read as "No activity". */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const at = iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(at)) return 'No activity'
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 14) return `${days} d ago`
  return new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) })
}
