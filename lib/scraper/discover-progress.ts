// Pure progress model for the Discover live panel.
//
// The /api/scrape stream reports plain-text log lines. This module turns those lines into
// counts and stage states without inventing totals the backend never reports:
//   - "Finding businesses" has a real target (the requested count).
//   - "Checking websites" and "Saving to My Leads" have no reported total, so they expose
//     real counts and an indeterminate state until they finish. They never show a percentage.
// Nothing here is rendered; the page maps the result to UI.
//
// Stage 1B: when the server sends typed `progress` events (see progress-events.ts) the
// "Checking websites" and "Saving" stages show real percentages from authoritative totals.
// Without those events (older server, or a stream that has not reached the stage yet) they
// fall back to the honest count-only, indeterminate behavior.

import type { ScrapeProgressEvent } from './progress-events'

export type StageState = 'pending' | 'active' | 'complete'

export type DiscoveryProgress = {
  /** Businesses announced so far (📥 lines). Monotonic. */
  candidatesFound: number
  /** Final business count once discovery finished (📦 discovered: N). */
  discoveredFinal: number | null
  /** True while the optional "Improving results" pass is searching more sources. */
  searchingMore: boolean
  /** Website checks started (🔬). */
  checksStarted: number
  /** Website checks that reached a conclusion (✨ email found, ⛔ no email). */
  checksFinished: number
  emailsFound: number
  noEmailCount: number
  /** Businesses with at least one contact method once checking finished (📦 enriched: N). */
  contactReady: number | null
  /** Parsed 💾 saved line (signed-in users only). */
  saved: { saved: number; duplicates: number; invalid: number; dbErrors: number } | null
  /** The server printed "Prospecting complete". Informational only: it is NOT the result. */
  completionLogSeen: boolean
  /** The authoritative `result` event arrived. */
  resultConfirmed: boolean
  /** Authoritative website-check totals from `progress` events; null until announced. */
  checks: { planned: number; completed: number; emailsFound: number } | null
  /** Authoritative save totals from `progress` events; null until announced. */
  saves: {
    considered: number
    processed: number
    saved: number
    duplicates: number
    invalid: number
    failed: number
  } | null
}

export const INITIAL_DISCOVERY_PROGRESS: DiscoveryProgress = {
  candidatesFound: 0,
  discoveredFinal: null,
  searchingMore: false,
  checksStarted: 0,
  checksFinished: 0,
  emailsFound: 0,
  noEmailCount: 0,
  contactReady: null,
  saved: null,
  completionLogSeen: false,
  resultConfirmed: false,
  checks: null,
  saves: null,
}

function toCount(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/** Folds one server log line into the progress model. Pure: returns a new object. */
export function applyDiscoveryLog(progress: DiscoveryProgress, message: string): DiscoveryProgress {
  if (!message) return progress

  if (message.startsWith('📥 ')) {
    return { ...progress, candidatesFound: progress.candidatesFound + 1 }
  }

  const discovered = message.match(/^📦 discovered: (\d+)/)
  if (discovered) {
    return { ...progress, discoveredFinal: toCount(discovered[1]) }
  }

  // The server marks the extra Google pass with the plain phase "Improving results".
  // It is more discovery, not validation.
  if (message === 'Improving results' || message.startsWith('🛰️ Google improvement pass')) {
    return { ...progress, searchingMore: true }
  }

  if (message.startsWith('🔬 ')) {
    return { ...progress, checksStarted: progress.checksStarted + 1 }
  }

  if (message.startsWith('✨ ')) {
    return {
      ...progress,
      checksFinished: progress.checksFinished + 1,
      emailsFound: progress.emailsFound + 1,
    }
  }

  if (message.startsWith('⛔ no email: ')) {
    return {
      ...progress,
      checksFinished: progress.checksFinished + 1,
      noEmailCount: progress.noEmailCount + 1,
    }
  }

  const enriched = message.match(/^📦 enriched: (\d+)/)
  if (enriched) {
    return { ...progress, contactReady: toCount(enriched[1]), searchingMore: false }
  }

  const saved = message.match(/^💾 saved: (\d+), duplicates: (\d+), invalid: (\d+), db errors: (\d+)/)
  if (saved) {
    return {
      ...progress,
      saved: {
        saved: toCount(saved[1]),
        duplicates: toCount(saved[2]),
        invalid: toCount(saved[3]),
        dbErrors: toCount(saved[4]),
      },
    }
  }

  if (message.includes('🎉 Prospecting complete')) {
    return { ...progress, completionLogSeen: true }
  }

  return progress
}

/**
 * Merges a typed progress event. Counters only ever move forward (per-field max), so a
 * duplicated or out-of-order event is harmless and totals never push a ratio past 100%.
 */
export function applyProgressEvent(progress: DiscoveryProgress, event: ScrapeProgressEvent): DiscoveryProgress {
  if (event.stage === 'checking') {
    const previous = progress.checks ?? { planned: 0, completed: 0, emailsFound: 0 }
    const planned = Math.max(previous.planned, event.planned)
    const next = {
      planned,
      completed: Math.min(Math.max(previous.completed, event.completed), planned),
      emailsFound: Math.max(previous.emailsFound, event.emailsFound),
    }
    if (progress.checks && JSON.stringify(progress.checks) === JSON.stringify(next)) return progress
    return { ...progress, checks: next }
  }

  const previous = progress.saves ?? { considered: 0, processed: 0, saved: 0, duplicates: 0, invalid: 0, failed: 0 }
  const processed = Math.max(previous.processed, event.processed)
  const next = {
    considered: Math.max(previous.considered, event.considered, processed),
    processed,
    saved: Math.max(previous.saved, event.saved),
    duplicates: Math.max(previous.duplicates, event.duplicates),
    invalid: Math.max(previous.invalid, event.invalid),
    failed: Math.max(previous.failed, event.failed),
  }
  if (progress.saves && JSON.stringify(progress.saves) === JSON.stringify(next)) return progress
  return { ...progress, saves: next }
}

export function confirmDiscoveryResult(progress: DiscoveryProgress): DiscoveryProgress {
  return { ...progress, resultConfirmed: true }
}

/**
 * The number shown as "businesses discovered": the real count announced so far, capped at the
 * requested amount, replaced by the authoritative final count once it arrives. It is never
 * interpolated; if the stream reports 0 then 10 in one burst, the value is 0 then 10.
 */
export function getDiscoveredCount(progress: DiscoveryProgress, requestedCount: number | null): number {
  if (progress.discoveredFinal !== null) return progress.discoveredFinal
  return requestedCount ? Math.min(progress.candidatesFound, requestedCount) : progress.candidatesFound
}

export type StageView = {
  key: 'finding' | 'checking' | 'saving'
  label: string
  state: StageState
  /** Short count shown beside the label. Never a percentage. */
  value: string
  detail: string
  /** 0–100 only when it is a real ratio or the stage is complete; otherwise null. */
  progress: number | null
  /** No total is known: render an indeterminate bar. */
  indeterminate: boolean
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function getStageViews(
  progress: DiscoveryProgress,
  requestedCount: number,
  options: { running: boolean; savedCount?: number | null }
): StageView[] {
  const requested = Number.isFinite(requestedCount) && requestedCount > 0 ? requestedCount : null
  const { running } = options

  // Stage 1: finding businesses (real target = requested count)
  const found =
    progress.discoveredFinal ??
    (requested ? Math.min(progress.candidatesFound, requested) : progress.candidatesFound)
  const findingComplete = progress.discoveredFinal !== null && !progress.searchingMore
  const findingState: StageState = findingComplete ? 'complete' : running ? 'active' : 'pending'

  const finding: StageView = {
    key: 'finding',
    label: 'Finding businesses',
    state: findingState,
    value: findingComplete
      ? pluralize(found, 'business', 'businesses') + ' found'
      : requested
        ? `${found} of ${requested}`
        : `${found}`,
    detail: progress.searchingMore
      ? 'Searching additional sources for stronger matches'
      : findingComplete
        ? requested && found < requested
          ? `${requested} requested`
          : 'Search complete'
        : 'Searching live business sources',
    progress: findingComplete ? 100 : requested ? Math.min((found / requested) * 100, 100) : null,
    indeterminate: !findingComplete && !requested,
  }

  // Stage 2: checking websites
  const checkingComplete = progress.contactReady !== null
  const checks = progress.checks
  let checking: StageView

  if (checks) {
    // Authoritative total: a real ratio, never above 100%.
    const noWork = checks.planned === 0
    const ratio = noWork ? 100 : Math.min((checks.completed / checks.planned) * 100, 100)
    const state: StageState = checkingComplete || noWork ? 'complete' : 'active'
    checking = {
      key: 'checking',
      label: 'Checking websites',
      state,
      value: noWork ? 'No websites to check' : `${checks.completed} of ${checks.planned}`,
      detail: noWork
        ? 'No businesses had a website to check'
        : `${pluralize(checks.emailsFound, 'email')} found`,
      progress: state === 'complete' ? 100 : ratio,
      indeterminate: false,
    }
  } else {
    const checkingState: StageState = checkingComplete
      ? 'complete'
      : progress.checksStarted > 0
        ? 'active'
        : 'pending'
    checking = {
      key: 'checking',
      label: 'Checking websites',
      state: checkingState,
      value: `${progress.checksFinished} checked`,
      detail:
        progress.checksFinished > 0 || checkingComplete
          ? `${pluralize(progress.emailsFound, 'email')} found`
          : checkingState === 'active'
            ? 'Reading business websites for contact details'
            : 'Waiting for businesses',
      progress: checkingComplete ? 100 : null,
      indeterminate: checkingState === 'active',
    }
  }

  // Stage 3: saving. Completion still belongs to the authoritative result event, even
  // when every attempt has been processed.
  const savingComplete = progress.resultConfirmed
  const saves = progress.saves
  const savingState: StageState = savingComplete
    ? 'complete'
    : saves || checkingComplete
      ? 'active'
      : 'pending'
  const savedCount = options.savedCount ?? saves?.saved ?? progress.saved?.saved ?? null
  let saving: StageView

  if (savingComplete) {
    saving = {
      key: 'saving',
      label: 'Saving to My Leads',
      state: 'complete',
      value: savedCount !== null ? `${savedCount} saved` : '',
      detail: 'Saved',
      progress: 100,
      indeterminate: false,
    }
  } else if (saves) {
    // Attempted and successfully saved are different numbers and are shown separately.
    const nothingToSave = saves.considered === 0
    const extras = [
      saves.duplicates > 0 ? pluralize(saves.duplicates, 'duplicate') : null,
      saves.invalid > 0 ? `${saves.invalid} invalid` : null,
      saves.failed > 0 ? `${saves.failed} failed` : null,
    ].filter(Boolean)
    saving = {
      key: 'saving',
      label: 'Saving to My Leads',
      state: 'active',
      value: nothingToSave ? 'Nothing to save' : `${saves.processed} of ${saves.considered} processed`,
      detail: nothingToSave ? 'No businesses to save' : [`${saves.saved} saved`, ...extras].join(' · '),
      progress: nothingToSave ? 100 : Math.min((saves.processed / saves.considered) * 100, 100),
      indeterminate: false,
    }
  } else {
    saving = {
      key: 'saving',
      label: 'Saving to My Leads',
      state: savingState,
      value: '',
      detail:
        savingState === 'active'
          ? progress.contactReady !== null
            ? `${pluralize(progress.contactReady, 'business', 'businesses')} with contact details`
            : 'Saving businesses'
          : 'Starts after websites are checked',
      progress: null,
      indeterminate: savingState === 'active',
    }
  }

  return [finding, checking, saving]
}
