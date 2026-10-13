// The one-question feedback, as plain rules: what may be sent, what is kept, and how repeated sends are handled.
//
// It is stored as one row per free trial in the existing analytics table (activity_logs, event "trial_feedback"), so no new table
// or migration is needed and it sits next to the funnel events it will be compared with. Nothing personal is collected: no email,
// no fingerprint, no free-form identity. The trial id (and the account id, if the visitor is signed in) is the association.

export const FEEDBACK_EVENT = 'trial_feedback'
export const FEEDBACK_ANSWERS = ['yes', 'partly', 'not_really'] as const
export type FeedbackAnswer = (typeof FEEDBACK_ANSWERS)[number]

export const FEEDBACK_MAX_COMMENT = 500
/** One row per trial; it can be corrected a few times (a mis-tap, then a comment), and no more. */
export const FEEDBACK_MAX_SENDS = 5

export const FEEDBACK_QUESTION = 'Did ALPA find what you were looking for?'
export const FEEDBACK_LABELS: Record<FeedbackAnswer, string> = { yes: 'Yes', partly: 'Partly', not_really: 'Not really' }
export const FEEDBACK_YES_THANKS = 'Glad ALPA helped. Good luck turning those businesses into customers.'
export const FEEDBACK_COMMENT_PROMPT = 'What could ALPA have done better?'

export type FeedbackInput = { answer: FeedbackAnswer; comment: string | null; analyticsSessionId: string | null; downloaded: boolean }

/** Reads a request body without trusting it. A comment is plain text, trimmed, with control characters removed, and at most 500 characters. */
export function parseFeedbackInput(body: unknown): { ok: true; input: FeedbackInput } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Invalid request.' }
  const raw = body as Record<string, unknown>
  if (typeof raw.answer !== 'string' || !(FEEDBACK_ANSWERS as readonly string[]).includes(raw.answer)) return { ok: false, message: 'Choose Yes, Partly or Not really.' }

  let comment: string | null = null
  if (raw.comment !== undefined && raw.comment !== null) {
    if (typeof raw.comment !== 'string') return { ok: false, message: 'Invalid request.' }
    // eslint-disable-next-line no-control-regex
    const cleaned = raw.comment.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    comment = cleaned ? cleaned.slice(0, FEEDBACK_MAX_COMMENT) : null
  }

  // The visitor's own analytics session, so the answer can be read next to the funnel events. Optional, never required.
  const session = typeof raw.analyticsSessionId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw.analyticsSessionId) ? raw.analyticsSessionId : null
  return { ok: true, input: { answer: raw.answer as FeedbackAnswer, comment, analyticsSessionId: session, downloaded: raw.downloaded === true } }
}

export type StoredFeedback = { answer: FeedbackAnswer; comment: string | null; sends: number }

/** What a stored row says, read back safely (the row is analytics data; it is never rendered as markup). */
export function readStoredFeedback(metadata: unknown): StoredFeedback | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const m = metadata as Record<string, unknown>
  if (typeof m.answer !== 'string' || !(FEEDBACK_ANSWERS as readonly string[]).includes(m.answer)) return null
  return {
    answer: m.answer as FeedbackAnswer,
    comment: typeof m.comment === 'string' && m.comment ? m.comment.slice(0, FEEDBACK_MAX_COMMENT) : null,
    sends: Number.isFinite(Number(m.sends)) ? Math.max(1, Number(m.sends)) : 1,
  }
}

export type TrialFacts = { trialId: string; savedBusinesses: number; searches: number; businessesUsed: number; trialCreatedAt: string | null; signedIn: boolean }

/**
 * The metadata to store. The latest answer wins and a later comment is added; the counts about the trial come from the server's own
 * record (never the browser), so the answer can be compared with how much of the allowance was used and how long ago the trial began.
 */
export function buildFeedbackMetadata(existing: unknown, input: FeedbackInput, trial: TrialFacts, now: Date = new Date()): { ok: true; metadata: Record<string, unknown> } | { ok: false; reason: 'too_many' } {
  const previous = readStoredFeedback(existing)
  const sends = (previous?.sends ?? 0) + 1
  if (previous && sends > FEEDBACK_MAX_SENDS) return { ok: false, reason: 'too_many' }
  const created = trial.trialCreatedAt ? Date.parse(trial.trialCreatedAt) : Number.NaN
  const prior = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {}
  const comment = input.comment ?? previous?.comment ?? null
  return {
    ok: true,
    metadata: {
      ...prior,
      trial_id: trial.trialId,
      answer: input.answer,
      comment,
      has_comment: Boolean(comment),
      sends,
      source: 'trial_results',
      signed_in: trial.signedIn,
      // from the server's record of the trial
      saved_businesses: trial.savedBusinesses,
      searches: trial.searches,
      businesses_used: trial.businessesUsed,
      trial_age_hours: Number.isFinite(created) ? Math.max(0, Math.round((now.getTime() - created) / 3_600_000)) : null,
      // from the page: whether the CSV had been downloaded when the answer was given
      downloaded: input.downloaded || prior.downloaded === true,
      ...(input.analyticsSessionId ? { analytics_session_id: input.analyticsSessionId } : {}),
      first_sent_at: typeof prior.first_sent_at === 'string' ? prior.first_sent_at : now.toISOString(),
      last_sent_at: now.toISOString(),
    },
  }
}
