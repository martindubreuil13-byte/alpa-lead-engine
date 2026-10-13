'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchGuestSnapshot } from '@/lib/guest/snapshot'
import { recoverGuestSearch, type GuestSnapshot } from '@/lib/guest/recovery'
import { describeSearchFailure, detectInAppBrowser, parseErrorBody, type SearchFailure } from '@/lib/guest/search-errors'
import { getOrCreateGuestSessionId, saveGuestLeads, upsertGuestLead } from '@/lib/guest-session'
import {
  applyDiscoveryLog,
  applyProgressEvent,
  confirmDiscoveryResult,
  INITIAL_DISCOVERY_PROGRESS,
  type DiscoveryProgress,
} from '@/lib/scraper/discover-progress'
import { isHiddenSystemLog } from '@/lib/scraper/live-activity'
import { parseProgressEvent } from '@/lib/scraper/progress-events'
import { advanceRunTimings, EMPTY_RUN_TIMINGS, startRunTimings, type RunTimings } from '@/lib/scraper/stage-timing'
import { trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { createAnalyticsSearchId, trackEvent } from '@/lib/track'
import type { TrialLead } from '@/lib/trial'

export type TrialStatus = 'idle' | 'running' | 'reconnecting' | 'failed' | 'finished'

// Silence (no bytes at all, not even the server's keepalive) after which the connection is treated as lost.
const STALL_AFTER_MS = 45_000

class SearchFailureError extends Error {
  failure: SearchFailure
  constructor(failure: SearchFailure) {
    super(failure.message)
    this.failure = failure
  }
}

type WakeLockLike = { release: () => Promise<void> }

function deviceContext() {
  try {
    return {
      online: navigator.onLine,
      in_app_browser: detectInAppBrowser(navigator.userAgent),
      standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    }
  } catch {
    return {}
  }
}

export type TrialSearchParams = { businessType: string; location: string; count: number }

/**
 * One free-trial discovery run, from the first request to the saved businesses.
 *
 * - Progress is the real engine's own stream (the same events the member Discover page reads), never simulated.
 * - If the connection is lost (screen lock, app switch, network change, a stalled stream) the search keeps running on the
 *   server; this waits for its real outcome from the server's record and then reports it.
 * - Nothing here can throw into the page: storage, ids and analytics are all guarded.
 */
export function useTrialSearch({ onFinished }: { onFinished: (info: { saved: number }) => void }) {
  const [status, setStatus] = useState<TrialStatus>('idle')
  const [failure, setFailure] = useState<SearchFailure | null>(null)
  const [progress, setProgress] = useState<DiscoveryProgress>(INITIAL_DISCOVERY_PROGRESS)
  const [logs, setLogs] = useState<string[]>([])
  const [timings, setTimings] = useState<RunTimings>(EMPTY_RUN_TIMINGS)
  const [nowMs, setNowMs] = useState(0)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const [requested, setRequested] = useState<number | null>(null)
  const [context, setContext] = useState({ businessType: '', location: '' })

  const searchingRef = useRef(false)
  const closedRef = useRef(false)
  const stalledRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const lastByteRef = useRef(0)
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wakeLockRef = useRef<WakeLockLike | null>(null)
  const lastSnapshotRef = useRef<GuestSnapshot | null>(null)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  const running = status === 'running' || status === 'reconnecting'

  useEffect(() => {
    setTimings((current) => advanceRunTimings(current, progress, Date.now()))
  }, [progress])

  useEffect(() => {
    if (!running) return
    setNowMs(Date.now())
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) clearInterval(watchdogRef.current)
    watchdogRef.current = null
  }, [])

  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockLike> } }
      if (nav.wakeLock && !wakeLockRef.current) wakeLockRef.current = await nav.wakeLock.request('screen')
    } catch {
      // optional: recovery covers a locked screen
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLockRef.current
    wakeLockRef.current = null
    void lock?.release().catch(() => {})
  }, [])

  // Keep the screen on while searching, and take the lock back after the visitor returns to the tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && searchingRef.current) void acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [acquireWakeLock])

  useEffect(() => {
    return () => {
      closedRef.current = true
      abortRef.current?.abort()
      if (watchdogRef.current) clearInterval(watchdogRef.current)
      void wakeLockRef.current?.release().catch(() => {})
    }
  }, [])

  const report = useCallback((event: string, data: Record<string, unknown>) => {
    void trackEvent(event, { metadata: { ...deviceContext(), ...data } })
  }, [])

  const fail = useCallback((next: SearchFailure) => {
    setFailure(next)
    setStatus('failed')
  }, [])

  /**
   * The connection was lost, or a search was already running. The search continues on the server, so wait for its real
   * outcome from the server's own record and show that, instead of reporting an error that did not happen.
   */
  const recover = useCallback(
    async (input: { assumeStarted: boolean; baselineAttempts: number | null; baselineLeads: number | null; stage: string }) => {
      setStatus('reconnecting')
      const startedAt = Date.now()
      const outcome = await recoverGuestSearch({
        fetchSession: async () => {
          const snapshot = await fetchGuestSnapshot()
          if (snapshot) lastSnapshotRef.current = snapshot
          return snapshot
        },
        baselineAttempts: input.baselineAttempts,
        baselineLeads: input.baselineLeads,
        assumeStarted: input.assumeStarted,
        onWaiting: () => setStatus('reconnecting'),
        shouldStop: () => closedRef.current,
      })
      if (closedRef.current) return
      report('trial_search_recovered', {
        stage: input.stage,
        outcome: outcome.state,
        leads: 'leads' in outcome ? outcome.leads : 0,
        elapsed_s: Math.floor((Date.now() - startedAt) / 1000),
      })

      if (outcome.state === 'completed' && outcome.leads > 0) {
        saveGuestLeads((lastSnapshotRef.current?.leads ?? []) as TrialLead[])
        setStatus('finished')
        onFinishedRef.current({ saved: outcome.leads })
        return
      }
      if (outcome.state === 'completed') {
        fail({ kind: 'unknown', message: 'The search finished but found no businesses. Try a broader business type or a different location.', retryable: true, resultsAvailable: false })
        return
      }
      if (outcome.state === 'not_started') {
        fail({ kind: 'network', message: 'We could not reach ALPA, so no search ran and nothing was used. Please try again.', retryable: true, resultsAvailable: false })
        return
      }
      fail({ kind: 'timeout', message: 'Your search may still be finishing. Open your businesses in a minute to check.', retryable: false, resultsAvailable: true })
    },
    [fail, report]
  )

  /** The page was reloaded or reopened while a search was still running on the server: pick it back up. */
  const resume = useCallback(async () => {
    if (searchingRef.current) return
    searchingRef.current = true
    closedRef.current = false
    setFailure(null)
    setNowMs(Date.now())
    setTimings((current) => (current.startedAt ? current : startRunTimings(Date.now())))
    try {
      await recover({ assumeStarted: true, baselineAttempts: null, baselineLeads: null, stage: 'resume' })
    } finally {
      searchingRef.current = false
    }
  }, [recover])

  const reset = useCallback(() => {
    setStatus('idle')
    setFailure(null)
    setProgress(INITIAL_DISCOVERY_PROGRESS)
    setLogs([])
    setTimings(EMPTY_RUN_TIMINGS)
    setLastEventAt(null)
  }, [])

  const start = useCallback(
    async ({ businessType, location, count }: TrialSearchParams) => {
      if (!businessType.trim() || !location.trim() || searchingRef.current) return
      searchingRef.current = true
      closedRef.current = false
      stalledRef.current = false

      const startedAt = Date.now()
      const collected: TrialLead[] = []
      let analyticsSearchId: string | null = null
      let stage: 'setup' | 'request' | 'stream' = 'setup'
      let sawResult = false
      let baseline: { attempts: number | null; leads: number | null } = { attempts: null, leads: null }

      try {
        const guestId = getOrCreateGuestSessionId()
        analyticsSearchId = createAnalyticsSearchId()
        trackGaEvent('free_trial_search_start', { business_type: businessType, location, lead_count: count })
        void trackEvent('trial_search_started', {
          search_id: analyticsSearchId,
          metadata: { source: 'trial_page', business_type: businessType, location, ...deviceContext() },
        })

        setFailure(null)
        setProgress(INITIAL_DISCOVERY_PROGRESS)
        setLogs([])
        setTimings(startRunTimings(startedAt))
        setNowMs(startedAt)
        setLastEventAt(startedAt)
        setRequested(count)
        setContext({ businessType: businessType.trim(), location: location.trim() })
        setStatus('running')
        void acquireWakeLock()

        // What the server already holds, so a lost connection can later be told apart from a search that never started.
        const fresh = await fetchGuestSnapshot(4_000)
        if (fresh) {
          lastSnapshotRef.current = fresh
          baseline = { attempts: fresh.attempts ?? 0, leads: fresh.leads?.length ?? 0 }
          if (fresh.searching) {
            await recover({ assumeStarted: true, baselineAttempts: null, baselineLeads: null, stage: 'already_running' })
            return
          }
        }

        stage = 'request'
        abortRef.current = new AbortController()
        lastByteRef.current = Date.now()
        stopWatchdog()
        watchdogRef.current = setInterval(() => {
          if (Date.now() - lastByteRef.current > STALL_AFTER_MS) {
            stalledRef.current = true
            abortRef.current?.abort()
          }
        }, 5_000)

        const res = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: businessType.trim(),
            defaultCity: location.trim(),
            maxLeads: count,
            outputLeadLimit: count,
            guestSessionId: guestId,
            guestTrial: true,
          }),
          signal: abortRef.current.signal,
        })
        lastByteRef.current = Date.now()

        if (!res.ok || !res.body) {
          const body = parseErrorBody(await res.text().catch(() => ''))
          if (body?.code === 'GUEST_RUNNING') {
            await recover({ assumeStarted: true, baselineAttempts: null, baselineLeads: null, stage: 'running_refusal' })
            return
          }
          throw new SearchFailureError(describeSearchFailure({ status: res.status, code: body?.code }))
        }

        stage = 'stream'
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          lastByteRef.current = Date.now()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            try {
              const evt = JSON.parse(trimmed.slice(5).trimStart())
              if (evt.type === 'log' && typeof evt.message === 'string') {
                const message = evt.message as string
                if (!message || message === '🟢 stream started' || isHiddenSystemLog(message)) continue
                setLogs((current) => [...current, message])
                setLastEventAt(Date.now())
                setProgress((current) => applyDiscoveryLog(current, message))
              } else if (evt.type === 'progress') {
                const event = parseProgressEvent(evt)
                if (event) {
                  setLastEventAt(Date.now())
                  setProgress((current) => applyProgressEvent(current, event))
                }
              } else if (evt.type === 'lead' && evt.payload) {
                const lead = evt.payload as TrialLead
                collected.unshift(lead)
                upsertGuestLead(lead)
              } else if (evt.type === 'result') {
                sawResult = true
                setProgress((current) => confirmDiscoveryResult(current, evt.payload?.discoveredCount))
              }
            } catch {
              // a malformed event line is skipped
            }
          }
        }

        // The stream ended without the search saying it finished (a proxy or the phone cut it): ask the server what happened.
        if (!sawResult && collected.length === 0) {
          report('trial_search_failed', { stage, kind: 'stream_ended_early', elapsed_s: Math.floor((Date.now() - startedAt) / 1000) })
          await recover({ assumeStarted: false, baselineAttempts: baseline.attempts, baselineLeads: baseline.leads, stage })
          return
        }
      } catch (err) {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)

        if (err instanceof SearchFailureError) {
          report('trial_search_failed', { stage, kind: err.failure.kind, elapsed_s: elapsedSeconds })
          fail(err.failure)
          return
        }

        // The visitor left on purpose (the page unmounted): nothing to report.
        if (closedRef.current && !stalledRef.current) return

        const connectionLost = stage !== 'setup'
        report('trial_search_failed', {
          stage,
          kind: stalledRef.current ? 'stalled' : connectionLost ? 'connection_lost' : 'setup_error',
          error_name: err instanceof Error ? err.name : 'unknown',
          elapsed_s: elapsedSeconds,
        })

        if (connectionLost) {
          stalledRef.current = false
          await recover({ assumeStarted: false, baselineAttempts: baseline.attempts, baselineLeads: baseline.leads, stage })
          return
        }

        fail(describeSearchFailure({}))
        return
      } finally {
        stopWatchdog()
        releaseWakeLock()
        searchingRef.current = false
      }

      const elapsedMs = Date.now() - startedAt
      const withEmail = collected.filter((lead) => lead.email?.trim()).length
      trackGaEvent('free_trial_search_complete', { lead_count: collected.length })
      void trackEvent('search_performed', {
        search_id: analyticsSearchId,
        query: businessType.trim(),
        search_query: businessType.trim(),
        business_type: businessType.trim(),
        location: location.trim(),
        filters_used: { requested_leads: count, source: 'trial_page' },
        leads_count: collected.length,
        number_of_results_returned: collected.length,
        number_of_results_with_email: withEmail,
        number_of_results_with_phone: collected.filter((lead) => lead.phone?.trim()).length,
        number_of_results_with_website: collected.filter((lead) => lead.website?.trim()).length,
        search_duration_ms: elapsedMs,
        no_results: collected.length === 0,
      })
      void trackEvent('results_viewed', { search_id: analyticsSearchId, query: businessType.trim(), location: location.trim(), leads_count: collected.length })

      if (collected.length === 0) {
        fail({ kind: 'unknown', message: 'No businesses were returned. Try a broader business type or a different location.', retryable: true, resultsAvailable: false })
        return
      }
      setStatus('finished')
      onFinishedRef.current({ saved: collected.length })
    },
    [acquireWakeLock, fail, recover, releaseWakeLock, report, stopWatchdog]
  )

  return { status, running, failure, progress, logs, timings, nowMs, lastEventAt, requested, context, start, resume, reset }
}
