import { findUnsupportedClaim } from './evidence-grounding.ts'
import type { BusinessSignals, CommercialProfile, WebsiteSnapshot } from './types.ts'

const MIN_EVIDENCE_WORDS = 30
const MIN_SUMMARY_WORDS = 45
const MAX_SUMMARY_WORDS = 90
// A site with little readable text cannot support a 45-word synopsis without padding it, and padding is exactly what the prompt
// forbids. Below this much evidence a shorter, still factual synopsis is accepted. (In production every successful profile came
// from 150+ words of evidence; the failures were thin sites.)
export const THIN_EVIDENCE_WORDS = 150
export const MIN_SUMMARY_WORDS_THIN = 25
/** At most one internal repair call per attempt, and only while both calls fit inside the per-job reservation. */
export const REPAIR_MAX_ATTEMPTS = 1
export const REPAIR_COST_CEILING_USD = 0.0015

// Bounded execution: no SDK retries so one stalled call cannot multiply runtime.
export const OPENAI_PROFILE_REQUEST_OPTIONS = { timeout: 30_000, maxRetries: 0 } as const

export type ProfileCompletionResult = {
  content: string
  inputTokens?: number
  outputTokens?: number
}

export type ProfileCompletion = (prompt: string) => Promise<ProfileCompletionResult>

export function getResearchEvidence(snapshot: WebsiteSnapshot) {
  const pages = snapshot.research_pages?.filter((page) => page.text.trim()) || []
  if (pages.length > 0) return pages

  const fallback = [snapshot.title, snapshot.meta_description, snapshot.h1, snapshot.body_excerpt]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return fallback
    ? [{ kind: 'homepage' as const, url: snapshot.source_urls?.[0] || '', text: fallback }]
    : []
}

export function researchEvidenceText(snapshot: WebsiteSnapshot) {
  return getResearchEvidence(snapshot).map((page) => page.text).join(' ')
}

export function researchEvidenceWords(snapshot: WebsiteSnapshot) {
  return researchEvidenceText(snapshot).trim().split(/\s+/).filter(Boolean).length
}

export function isThinEvidence(snapshot: WebsiteSnapshot) {
  return researchEvidenceWords(snapshot) < THIN_EVIDENCE_WORDS
}

/** Cost in US dollars of one call at gpt-4o-mini list prices (an estimate; the provider's own token counts are used). */
export function estimateProfileCost(inputTokens: number, outputTokens: number) {
  return inputTokens * 0.00000015 + outputTokens * 0.0000006
}

export function hasSufficientResearchEvidence(snapshot: WebsiteSnapshot) {
  const wordCount = getResearchEvidence(snapshot)
    .map((page) => page.text)
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  return wordCount >= MIN_EVIDENCE_WORDS
}

export function buildCommercialProfilePrompt(
  website: string,
  snapshot: WebsiteSnapshot,
  signals: BusinessSignals,
  options: { repair?: { code: ProfileRejection; words: number } } = {}
) {
  const thin = isThinEvidence(snapshot)
  const lengthRule = thin
    ? 'The website says little, so the summary may be short: 25-60 words. State only what the text says; never add words to reach a length.'
    : 'The summary must be approximately 50-80 words.'
  const evidence = getResearchEvidence(snapshot)
    .map(
      (page) =>
        `SOURCE: ${page.kind.toUpperCase()}\nURL: ${page.url || website}\nCONTENT:\n${page.text}`
    )
    .join('\n\n---\n\n')

  return `
Website: ${website}

The following text was retrieved directly from the company's public website. Treat it as the only source of truth.

${evidence}

Observed website signals:
- Contact page retrieved: ${signals.has_contact_page}
- About page retrieved: ${signals.has_about_page}
- Services or products page retrieved: ${signals.has_services_page}

Return only valid JSON in this exact structure:
{
  "summary": "${thin ? 'A factual 25-60 word synopsis' : 'A factual 50-80 word synopsis'}",
  "industry": "Supported industry or empty string",
  "business_category": "Supported business type or empty string",
  "primary_service": "Supported main product or service or empty string",
  "core_services": ["Only services explicitly supported by the evidence"],
  "target_customer": "Supported customer group or empty string",
  "competitive_advantage": "Only an explicitly stated specialization or differentiator, otherwise empty string",
  "keywords": ["Evidence-based keyword"]
}

Rules:
- ${lengthRule}
- Explain what the company does and its principal products or services.
- Mention target customers only when the website identifies them.
- Include a specialization only when directly supported by the source text.
- Do not use generic promotional language.
- Do not infer market position, company size, customers, geography, or competitive advantages.
- Do not invent missing information. Use empty strings or empty arrays instead.
- Do not include numbers, web addresses or email addresses that are not in the text above.${repairNote(options.repair, thin)}
`.trim()
}

export type ProfileRejection = 'not_json' | 'too_short' | 'too_long' | 'unsupported_figure' | 'unsupported_address'

function repairNote(repair: { code: ProfileRejection; words: number } | undefined, thin: boolean) {
  if (!repair) return ''
  // Only the reason and the length are repeated; the rejected answer itself is never sent back or kept.
  const range = thin ? '25-60' : '50-80'
  const reason: Record<ProfileRejection, string> = {
    not_json: 'it was not valid JSON in the required structure',
    too_short: `its summary had ${repair.words} words, fewer than the ${range} required`,
    too_long: `its summary had ${repair.words} words, more than the ${range} allowed`,
    unsupported_figure: 'it contained a number that is not in the website text',
    unsupported_address: 'it contained a web or email address that is not in the website text',
  }
  return `\n\nYour previous answer was rejected because ${reason[repair.code]}. Answer again with the same JSON structure, using only the website text above.`
}

export type ProfileValidation =
  | { ok: true; profile: CommercialProfile }
  | { ok: false; code: ProfileRejection; words: number }

/**
 * Reads the model's answer. `minWords` is 45 normally and lower for a site with thin evidence; with `evidence` it also refuses
 * figures and addresses the website text does not contain. Returns a reason code, never the rejected text.
 */
export function validateCommercialProfileResponse(content: string, options: { minWords?: number; evidence?: string } = {}): ProfileValidation {
  let parsed: Record<string, unknown>
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ok: false, code: 'not_json', words: 0 }
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  } catch {
    return { ok: false, code: 'not_json', words: 0 }
  }
  const summary = cleanString(parsed.summary, 700)
  const words = summary.split(/\s+/).filter(Boolean).length
  if (words < (options.minWords ?? MIN_SUMMARY_WORDS)) return { ok: false, code: 'too_short', words }
  if (words > MAX_SUMMARY_WORDS) return { ok: false, code: 'too_long', words }
  if (options.evidence !== undefined) {
    const problem = findUnsupportedClaim(summary, options.evidence)
    if (problem) return { ok: false, code: problem, words }
  }
  return {
    ok: true,
    profile: {
      summary,
      industry: cleanString(parsed.industry, 100),
      business_category: cleanString(parsed.business_category, 100),
      primary_service: cleanString(parsed.primary_service, 200),
      core_services: cleanStringArray(parsed.core_services, 5, 120),
      target_customer: cleanString(parsed.target_customer, 200),
      competitive_advantage: cleanString(parsed.competitive_advantage, 300),
      keywords: cleanStringArray(parsed.keywords, 10, 80),
      generated_at: new Date().toISOString(),
    },
  }
}

export async function generateProfileFromEvidence(
  website: string,
  snapshot: WebsiteSnapshot,
  signals: BusinessSignals,
  complete: ProfileCompletion,
  options: { repairCostCeilingUsd?: number } = {}
) {
  if (!hasSufficientResearchEvidence(snapshot)) {
    return {
      ok: false as const,
      error: {
        code: 'INSUFFICIENT_INFORMATION',
        message: 'The website did not provide enough readable business information for a factual synopsis',
      },
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    }
  }

  const evidence = researchEvidenceText(snapshot)
  const minWords = isThinEvidence(snapshot) ? MIN_SUMMARY_WORDS_THIN : MIN_SUMMARY_WORDS
  let inputTokens = 0
  let outputTokens = 0
  let calls = 0
  let verdict: ProfileValidation = { ok: false, code: 'not_json', words: 0 }

  // The first call, and at most REPAIR_MAX_ATTEMPTS more: only for an answer that failed validation, only while the
  // calls so far plus another of the same size still fit under the repair ceiling, and always on the same fetched text.
  for (let attempt = 0; attempt <= REPAIR_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      const spent = estimateProfileCost(inputTokens, outputTokens)
      if (verdict.ok || spent * 2 > (options.repairCostCeilingUsd ?? REPAIR_COST_CEILING_USD)) break
    }
    const repair = attempt > 0 && !verdict.ok ? { code: verdict.code, words: verdict.words } : undefined
    const completion = await complete(buildCommercialProfilePrompt(website, snapshot, signals, { repair }))
    calls += 1
    inputTokens += completion.inputTokens || 0
    outputTokens += completion.outputTokens || 0
    verdict = validateCommercialProfileResponse(completion.content, { minWords, evidence: `${evidence} ${website}` })
    if (verdict.ok) break
  }

  if (!verdict.ok) {
    return {
      ok: false as const,
      error: {
        code: 'INVALID_RESPONSE',
        // A reason code and a word count only: no website text and no model output are kept in the diagnostic.
        message: `profile_rejected:${verdict.code}:${verdict.words}w:calls=${calls}`,
      },
      inputTokens,
      outputTokens,
      calls,
    }
  }

  return {
    ok: true as const,
    data: verdict.profile,
    inputTokens,
    outputTokens,
    calls,
  }
}

export function parseCommercialProfileResponse(content: string): CommercialProfile | null {
  const verdict = validateCommercialProfileResponse(content)
  return verdict.ok ? verdict.profile : null
}

function cleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}
