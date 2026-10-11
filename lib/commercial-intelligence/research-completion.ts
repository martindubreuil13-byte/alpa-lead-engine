// What a research result is allowed to tell the database.
//
// complete_ci_enrichment[_worker] is the single place where a queue job and its lead are finalized
// together (one transaction, fenced by the claim). This module only decides WHICH outcome to report
// to it, so that "success" always means a usable profile exists:
//
//   - a profile with a summary, plus its snapshot and signals  -> success
//   - a lead with no website (nothing to research)               -> success with no data ("skipped")
//   - anything else, including a "success" without a profile     -> failure (retry policy applies)

export type CompletionSource = {
  success: boolean
  ci_enrichment_status?: string
  website_snapshot?: unknown
  business_signals?: unknown
  commercial_profile?: unknown
  ci_last_error?: string | null
}

export type CompletionArguments = {
  snapshot: unknown
  signals: unknown
  profile: unknown
  success: boolean
  errorMessage?: string
}

export function hasUsableProfile(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false
  const summary = (profile as { summary?: unknown }).summary
  return typeof summary === 'string' && summary.trim().length > 0
}

export function buildCompletion(result: CompletionSource): CompletionArguments {
  if (result.success && result.ci_enrichment_status === 'skipped') {
    return { snapshot: null, signals: null, profile: null, success: true }
  }

  if (result.success && hasUsableProfile(result.commercial_profile) && result.website_snapshot && result.business_signals) {
    return {
      snapshot: result.website_snapshot,
      signals: result.business_signals,
      profile: result.commercial_profile,
      success: true,
    }
  }

  return {
    snapshot: null,
    signals: null,
    profile: null,
    success: false,
    errorMessage: result.success
      ? 'Research finished without a usable business profile'
      : result.ci_last_error || 'Research failed',
  }
}
