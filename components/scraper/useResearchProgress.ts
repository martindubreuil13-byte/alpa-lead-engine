'use client'

import { useEffect, useState } from 'react'

import { toRunClock, type RunClock, type RunTiming } from '@/lib/intelligence/run-clock'
import type { IntelligenceStage, ProfileCard, ProfileReason, ProfileState } from '@/lib/intelligence/run-progress'

export type ResearchProgress = {
  runId: string
  running: boolean
  stage: IntelligenceStage | null
  rows: Array<{ leadId: string; state: ProfileState; reason: ProfileReason }>
  profiles: Record<string, ProfileCard>
  /** Run start and end on this browser's clock, from timestamps the server persisted. Null before the run is known. */
  clock: RunClock | null
}

// How often the page asks the server for the real state. It is a read: it never starts, claims or retries research.
const FAST_MS = 4_000
const SLOW_MS = 15_000
const IDLE_MS = 30_000
const FAST_WINDOW_MS = 3 * 60_000

/**
 * Follows one Discover run's Business Intelligence. All state comes from the server on every poll, so a refresh or a
 * return visit shows exactly what the database says; nothing is remembered, animated or estimated here. Polling pauses
 * while the tab is hidden, resumes immediately when it becomes visible, and stops for good once nothing is unresolved.
 * `fetcher` exists only so the development review page can answer from a local fixture; production never passes it.
 */
export type ProgressFetcher = (url: string, init: { cache: RequestCache; signal: AbortSignal }) => Promise<Response>

export function useResearchProgress({ runId, enabled, fetcher }: { runId: string | null; enabled: boolean; fetcher?: ProgressFetcher }) {
  const [progress, setProgress] = useState<ResearchProgress | null>(null)

  useEffect(() => {
    if (!enabled || !runId) {
      setProgress(null)
      return
    }

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    const startedAt = Date.now()

    const schedule = (delay: number) => {
      if (stopped) return
      timer = setTimeout(poll, delay)
    }

    async function poll() {
      if (stopped) return
      if (document.hidden) return // resumed by the visibilitychange handler
      controller = new AbortController()
      let next = Date.now() - startedAt < FAST_WINDOW_MS ? FAST_MS : SLOW_MS
      try {
        const response = await (fetcher ?? fetch)(`/api/research/runs/${runId}`, { cache: 'no-store', signal: controller.signal })
        if (response.ok) {
          const data = (await response.json()) as { ok?: boolean; timing?: RunTiming | null } & Partial<Omit<ResearchProgress, 'clock'>>
          if (data.ok && data.runId) {
            setProgress({ runId: data.runId, running: Boolean(data.running), stage: data.stage ?? null, rows: data.rows ?? [], profiles: data.profiles ?? {}, clock: toRunClock(data.timing, Date.now()) })
            const phase = data.stage?.phase
            if (phase === 'complete' || phase === 'stopped') {
              if (!data.stage?.live) return // everything resolved: stop polling
            }
            if (phase === 'not_running') next = IDLE_MS
          }
        }
      } catch {
        // offline or aborted: try again later; the customer's results are not affected
      }
      schedule(next)
    }

    const onVisible = () => {
      if (!document.hidden && !stopped) {
        if (timer) clearTimeout(timer)
        void poll()
      }
    }

    document.addEventListener('visibilitychange', onVisible)
    void poll()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runId, enabled, fetcher])

  return progress
}
