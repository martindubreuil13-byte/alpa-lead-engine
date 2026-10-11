// The three research stages (website snapshot, business signals, profile) under one deadline.
// Pure: the stages are injected, so the deadline and error handling can be tested offline.

import { createResearchDeadline, ResearchDeadlineError, RESEARCH_DEADLINE_MS } from './research-deadline.ts'
import type { BusinessSignals, CommercialProfile, ExtractionResult, WebsiteSnapshot } from './types.ts'

export type ResearchStageContext = { signal: AbortSignal }

export type ResearchStages = {
  snapshot(website: string, context: ResearchStageContext): Promise<ExtractionResult<WebsiteSnapshot>>
  signals(website: string, context: ResearchStageContext): Promise<ExtractionResult<BusinessSignals>>
  profile(
    website: string,
    snapshot: WebsiteSnapshot,
    signals: BusinessSignals,
    context: ResearchStageContext
  ): Promise<ExtractionResult<CommercialProfile>>
}

export type ResearchOutcome = {
  snapshot: ExtractionResult<WebsiteSnapshot>
  signals: ExtractionResult<BusinessSignals>
  profile: ExtractionResult<CommercialProfile>
  errors: string[]
  cost: number
  deadlineExceeded: boolean
}

const notRun = (): ExtractionResult<never> => ({ ok: false, duration_ms: 0, cost: 0 })

export async function runResearchStages(
  website: string,
  stages: ResearchStages,
  options: { deadlineMs?: number; deadline?: ReturnType<typeof createResearchDeadline> } = {}
): Promise<ResearchOutcome> {
  const deadline = options.deadline ?? createResearchDeadline(options.deadlineMs ?? RESEARCH_DEADLINE_MS)
  const ownsDeadline = !options.deadline
  const context = { signal: deadline.signal }
  const errors: string[] = []
  let cost = 0
  let deadlineExceeded = false

  let snapshot: ExtractionResult<WebsiteSnapshot> = notRun()
  let signals: ExtractionResult<BusinessSignals> = notRun()
  let profile: ExtractionResult<CommercialProfile> = notRun()

  // Runs one stage. A stage that throws becomes a failed result with the same message as before;
  // an expired deadline stops the run and is reported as one clear error.
  async function stage<T>(
    name: string,
    failureLabel: string,
    code: string,
    work: () => Promise<ExtractionResult<T>>
  ): Promise<ExtractionResult<T>> {
    try {
      const result = await deadline.guard(work(), name)
      cost += result.cost || 0
      if (!result.ok) errors.push(result.error?.message || `Failed: ${name}`)
      return result
    } catch (error) {
      if (error instanceof ResearchDeadlineError) {
        deadlineExceeded = true
        errors.push(error.message)
        return { ok: false, error: { code: error.code, message: error.message }, duration_ms: 0, cost: 0 }
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      errors.push(`${failureLabel}: ${message}`)
      return { ok: false, error: { code, message }, duration_ms: 0, cost: 0 }
    }
  }

  try {
    snapshot = await stage('website snapshot', 'Website snapshot extraction failed', 'SNAPSHOT_ERROR', () =>
      stages.snapshot(website, context)
    )
    if (!deadlineExceeded) {
      signals = await stage('business signals', 'Business signals generation failed', 'SIGNALS_ERROR', () =>
        stages.signals(website, context)
      )
    }

    if (deadlineExceeded) {
      // Nothing more is started once the deadline has passed.
    } else if (snapshot.ok && signals.ok && snapshot.data && signals.data) {
      const snapshotData = snapshot.data
      const signalsData = signals.data
      profile = await stage('commercial profile', 'Commercial profile generation failed', 'PROFILE_ERROR', () =>
        stages.profile(website, snapshotData, signalsData, context)
      )
    } else {
      errors.push('Commercial profile generation skipped due to snapshot or signals failure')
    }
  } finally {
    if (ownsDeadline) deadline.dispose()
  }

  return { snapshot, signals, profile, errors, cost, deadlineExceeded }
}
