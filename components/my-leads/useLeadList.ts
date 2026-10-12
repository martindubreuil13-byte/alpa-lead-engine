'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { LeadListItem, LeadSummary } from '@/lib/my-leads/list'
import { filtersToSearch, type FilterState } from '@/lib/my-leads/ui-state'

type ListState = { items: LeadListItem[]; total: number; loading: boolean; error: boolean }

function leaveForLogin() {
  if (typeof window !== 'undefined') window.location.href = '/login'
}

/**
 * One page of the customer's businesses from /api/my-leads, for the current filters. The previous page stays on screen while the
 * next loads (no flash of empty), a newer request cancels an older one, and nothing here ever asks for more than one page.
 */
export function useLeadList(filters: FilterState) {
  const [state, setState] = useState<ListState>({ items: [], total: 0, loading: true, error: false })
  const [version, setVersion] = useState(0)
  const query = filtersToSearch(filters).toString()

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: true, error: false }))
    fetch(`/api/my-leads${query ? `?${query}` : ''}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return leaveForLogin()
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.ok) throw new Error('unavailable')
        setState({ items: data.items as LeadListItem[], total: data.total as number, loading: false, error: false })
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        setState((current) => ({ ...current, loading: false, error: true }))
      })
    return () => controller.abort()
  }, [query, version])

  const refresh = useCallback(() => setVersion((current) => current + 1), [])
  return { ...state, refresh }
}

/** The overview counts (total, ready, awaiting, needing attention, archived), fetched on their own and refreshed after changes. */
export function useLeadSummary() {
  const [summary, setSummary] = useState<LeadSummary | null>(null)
  const [version, setVersion] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    fetch('/api/my-leads?summary=1&pageSize=1', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return leaveForLogin()
        const data = await response.json().catch(() => null)
        if (response.ok && data?.ok && data.summary && mounted.current) setSummary(data.summary as LeadSummary)
      })
      .catch(() => undefined)
    return () => {
      mounted.current = false
      controller.abort()
    }
  }, [version])

  const refreshSummary = useCallback(() => setVersion((current) => current + 1), [])
  return { summary, refreshSummary }
}
