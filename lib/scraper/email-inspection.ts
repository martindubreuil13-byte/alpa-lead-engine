// How well a business's website was actually inspected for an email address.
//
// The email pipeline already knows this for every business (it logs it), but only the address used to
// survive: "the pages were read and there is no email" and "the website could not be read" both arrived as
// "no email found". This is the small, additive record that carries the difference through the existing
// Discover stream and results payload. It is not stored in the database.
//
//   checked      at least one page of the business's own website was read
//     partial    ...but some pages could not be (timeout, blocked, too large, refused by robots.txt).
//                Independent of whether an address was found: an email and a partial warning can coexist.
//   unreadable   no page could be read, so nothing is known about the site. Never "no email published".
//   no_website   there was no website of its own to inspect
//
// It never changes an email's confidence: that is decided by the extractor alone.

export type EmailInspectionState = 'checked' | 'unreadable' | 'no_website'

export type EmailInspection = { state: EmailInspectionState; partial: boolean }

/** The facts about one visit that decide the state (a subset of the pipeline's outcome). */
export type InspectionSource = {
  pagesRequested: number
  pagesLoaded: number
  partialAccess: boolean
  truncated: boolean
  robots: string
  accessFailure: string | null
}

export function inspectionFromOutcome(outcome: InspectionSource): EmailInspection {
  if (outcome.pagesLoaded > 0) {
    return { state: 'checked', partial: outcome.partialAccess || outcome.truncated }
  }

  // The pipeline returns an "empty" outcome, before any request, when the website is missing, malformed
  // or not a business website (a social profile, a directory listing).
  if (outcome.pagesRequested === 0 && outcome.robots === 'skipped' && outcome.accessFailure === 'unsafe') {
    return { state: 'no_website', partial: false }
  }

  return { state: 'unreadable', partial: false }
}

// Lower is a better, more informative inspection.
function rank(inspection: EmailInspection) {
  if (inspection.state === 'checked') return inspection.partial ? 1 : 0
  return inspection.state === 'unreadable' ? 2 : 3
}

/**
 * A business can be inspected more than once in a search (a second pass after the first). The better
 * inspection wins, so a later failure never hides that an earlier visit did read the site.
 */
export function mergeInspection(
  previous: EmailInspection | null | undefined,
  next: EmailInspection | null | undefined
): EmailInspection | null {
  if (!previous) return next ?? null
  if (!next) return previous
  return rank(next) <= rank(previous) ? next : previous
}

/** Validates an untrusted value (a stored result, a guest lead from the stream). */
export function isEmailInspection(value: unknown): value is EmailInspection {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.state === 'checked' || candidate.state === 'unreadable' || candidate.state === 'no_website') &&
    typeof candidate.partial === 'boolean'
  )
}
