// Customer-facing failure handling for Discover.
//
// The stream can fail in several ways (HTTP rejection, a fatal log line, a dropped
// connection, or a stream that ends without the authoritative `result` event). This module
// decides which kind of failure it was and what to tell the customer. It never exposes raw
// server messages, stack traces or database errors.

export type SearchFailureKind =
  | 'quota' // HTTP 403: monthly allowance reached
  | 'auth' // HTTP 401: session expired or not signed in
  | 'network' // the connection dropped
  | 'interrupted' // the request failed in an unexpected way
  | 'no_result' // the stream ended without a result event
  | 'server' // a fatal server event, or another HTTP error

export type SearchFailureAction = 'my-leads' | 'retry' | 'billing' | 'sign-in'

export type SearchFailure = {
  kind: SearchFailureKind
  title: string
  body: string
  actions: SearchFailureAction[]
}

/** Lines the server sends when it gives up on a search. */
export function isFatalSearchLog(message: string) {
  return (
    message.includes('❌ fatal') ||
    message.includes('❌ invalid input') ||
    message.includes('❌ missing authenticated user')
  )
}

/**
 * The only reliable codes the existing API provides are HTTP statuses:
 * 403 = monthly limit reached, 401 = not signed in. Everything else non-OK is a server error.
 */
export function classifyHttpStatus(status: number): SearchFailureKind | null {
  if (status >= 200 && status < 300) return null
  if (status === 403) return 'quota'
  if (status === 401) return 'auth'
  return 'server'
}

export function classifyThrown(error: unknown): SearchFailureKind {
  const message = error instanceof Error ? error.message : ''
  if (error instanceof TypeError || /network|failed to fetch|load failed|connection|terminated/i.test(message)) {
    return 'network'
  }
  return 'interrupted'
}

export type SearchOutcome =
  | { status: 'completed' }
  | { status: 'aborted' }
  | { status: 'failed'; kind: SearchFailureKind }

/**
 * Decides how a search ended. An authoritative result always wins: a failure is never shown
 * once the result event has confirmed completion, even if the connection closes badly after.
 */
export function resolveSearchOutcome(input: {
  resultConfirmed: boolean
  aborted?: boolean
  httpStatus?: number
  fatalSeen?: boolean
  thrown?: unknown
}): SearchOutcome {
  if (input.resultConfirmed) return { status: 'completed' }
  if (input.aborted) return { status: 'aborted' }

  if (typeof input.httpStatus === 'number') {
    const kind = classifyHttpStatus(input.httpStatus)
    if (kind) return { status: 'failed', kind }
  }

  if (input.thrown !== undefined) return { status: 'failed', kind: classifyThrown(input.thrown) }
  if (input.fatalSeen) return { status: 'failed', kind: 'server' }
  return { status: 'failed', kind: 'no_result' }
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function buildSearchFailure(
  kind: SearchFailureKind,
  options: { savedCount?: number } = {}
): SearchFailure {
  if (kind === 'quota') {
    return {
      kind,
      title: 'You’ve reached your plan limit.',
      body: 'This search wasn’t started. Check Plan & Billing for your allowance.',
      actions: ['billing', 'my-leads'],
    }
  }

  if (kind === 'auth') {
    return {
      kind,
      title: 'Your session has ended.',
      body: 'Sign in again to continue. Your search details are kept.',
      actions: ['sign-in'],
    }
  }

  const saved = options.savedCount ?? 0
  return {
    kind,
    title: 'We couldn’t finish this search.',
    body:
      saved > 0
        ? `${plural(saved, 'business', 'businesses')} ${saved === 1 ? 'was' : 'were'} saved before the interruption. Check My Leads before trying again.`
        : 'Some businesses may have been saved before the interruption. Check My Leads before trying again.',
    actions: ['my-leads', 'retry'],
  }
}
