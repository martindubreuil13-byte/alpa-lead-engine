export type BusinessRelevance = 'match' | 'uncertain' | 'mismatch'
type Candidate = { company_name: string; industry?: string | null }
const tidy = (s: string) => s.toLowerCase().replace(/[_-]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const consult = /\b(consultant|consultants|consulting|consultancy)\b/
const recruitment = /\b(employment|recruitment|recruiting|staffing|recruiter|recruiters|personnel)\b/
const seo = /\bseo\b|search engine optimi[sz]ation/
const marketing = /\b(marketing|advertising|web design|website design|web development)\b/
const generic = /^(establishment|point of interest|premise|agency|business|service|services|company)$/

/** Evidence from the provider's category and business name; never a claim of verified services.
 * Clear category conflicts beat a suggestive name. Broad consultant searches retain all consultant
 * specialties. Unknown search types/categories remain uncertain rather than silently excluded.
 */
export function classifyBusinessRelevance(query: string, candidate: Candidate): BusinessRelevance {
  const q = tidy(query), name = tidy(candidate.company_name), category = tidy(candidate.industry ?? '')
  const knownCategory = Boolean(category && !generic.test(category))
  if (seo.test(q)) {
    if (knownCategory && !seo.test(category) && !marketing.test(category) && !consult.test(category)) return 'mismatch'
    if (seo.test(category) || seo.test(name)) return 'match'
    return 'uncertain' // A marketing agency may offer SEO; its provider label alone does not establish it.
  }
  if (consult.test(q)) {
    if (recruitment.test(q)) {
      if (recruitment.test(category)) return 'match'
      if (knownCategory && !consult.test(category)) return 'mismatch'
      return 'uncertain'
    }
    if (knownCategory && recruitment.test(category)) return 'mismatch'
    if (consult.test(category)) {
      const specialty = /\b(it|health|financial|management|business)\b/.exec(q)?.[1]
      if (!specialty) return 'match'
      const compatible = specialty === 'it' ? /\b(it|computer|technology|software)\b/ : specialty === 'business' || specialty === 'management' ? /\b(business|management)\b/ : new RegExp(`\\b${specialty}\\b`)
      if (compatible.test(category)) return 'match'
      const hasOtherSpecialty = /\b(it|computer|technology|software|health|financial|business|management)\b/.test(category)
      return hasOtherSpecialty ? 'mismatch' : 'uncertain'
    }
    if (knownCategory) return 'mismatch'
    return consult.test(name) ? 'match' : 'uncertain'
  }
  return 'uncertain'
}

/** Stable ranking preserves provider order within each evidence class. */
export function rankBusinessCandidates<T extends Candidate>(query: string, candidates: T[]): T[] {
  const rank = { match: 0, uncertain: 1, mismatch: 2 }
  return candidates.map((candidate, index) => ({ candidate, index, rank: rank[classifyBusinessRelevance(query, candidate)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ candidate }) => candidate)
}
