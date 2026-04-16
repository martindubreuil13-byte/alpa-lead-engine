export type RelevanceTier = 'high' | 'medium' | 'low'

export type RelevanceResult = {
  score: number
  tier: RelevanceTier
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse raw audience_input ("freelancer, virtual assistant") into
 * a strict list of normalized category strings used for lead filtering.
 */
export function deriveAllowedCategories(audienceInput: string | null | undefined): string[] {
  if (!audienceInput) return []
  return audienceInput
    .split(/[,;\/]/)
    .map((s) => normalize(s))
    .filter((s) => s.length > 1)
}

/**
 * Score a lead against allowed ICP categories using company_name + industry.
 * Returns a 0–1 score and a tier label.
 *
 * Score guide:
 *   1.0  — full phrase match (e.g. "freelancer" inside "John Smith Freelancer")
 *   0.85 — all keywords individually present
 *   0.65 — ≥50% of category keywords present
 *   0.4  — any keyword present
 *   0.3  — no match found
 *
 * Threshold: leads with score < 0.6 are considered off-target.
 */
export function scoreLeadRelevance(
  lead: { company_name?: string | null; industry?: string | null },
  allowedCategories: string[]
): RelevanceResult {
  // No filter configured — accept everything
  if (allowedCategories.length === 0) return { score: 1.0, tier: 'high' }

  const haystack = normalize(
    [lead.company_name || '', lead.industry || ''].join(' ')
  )

  if (!haystack.trim()) return { score: 0.3, tier: 'low' }

  let maxScore = 0

  for (const category of allowedCategories) {
    const keywords = category.split(' ').filter(Boolean)
    if (keywords.length === 0) continue

    // Full phrase match
    if (haystack.includes(category)) {
      maxScore = 1.0
      break
    }

    // All keywords individually present (in any order)
    if (keywords.every((kw) => haystack.includes(kw))) {
      maxScore = Math.max(maxScore, 0.85)
      continue
    }

    // Partial keyword match
    const matched = keywords.filter((kw) => haystack.includes(kw))
    const ratio = matched.length / keywords.length

    if (ratio >= 0.5) {
      maxScore = Math.max(maxScore, 0.65)
    } else if (ratio > 0) {
      maxScore = Math.max(maxScore, 0.4)
    }
  }

  const tier: RelevanceTier = maxScore >= 0.8 ? 'high' : maxScore >= 0.6 ? 'medium' : 'low'
  return { score: maxScore, tier }
}
