import type { BusinessSignals, CommercialProfile, WebsiteSnapshot } from './types.ts'

const MIN_EVIDENCE_WORDS = 30
const MIN_SUMMARY_WORDS = 45
const MAX_SUMMARY_WORDS = 90

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
  signals: BusinessSignals
) {
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
  "summary": "A factual 50-80 word synopsis",
  "industry": "Supported industry or empty string",
  "business_category": "Supported business type or empty string",
  "primary_service": "Supported main product or service or empty string",
  "core_services": ["Only services explicitly supported by the evidence"],
  "target_customer": "Supported customer group or empty string",
  "competitive_advantage": "Only an explicitly stated specialization or differentiator, otherwise empty string",
  "keywords": ["Evidence-based keyword"]
}

Rules:
- The summary must be approximately 50-80 words.
- Explain what the company does and its principal products or services.
- Mention target customers only when the website identifies them.
- Include a specialization only when directly supported by the source text.
- Do not use generic promotional language.
- Do not infer market position, company size, customers, geography, or competitive advantages.
- Do not invent missing information. Use empty strings or empty arrays instead.
`.trim()
}

export async function generateProfileFromEvidence(
  website: string,
  snapshot: WebsiteSnapshot,
  signals: BusinessSignals,
  complete: ProfileCompletion
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
    }
  }

  const completion = await complete(buildCommercialProfilePrompt(website, snapshot, signals))
  const profile = parseCommercialProfileResponse(completion.content)

  if (!profile) {
    return {
      ok: false as const,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'The AI response was invalid or did not contain a factual 50-80 word synopsis',
      },
      inputTokens: completion.inputTokens || 0,
      outputTokens: completion.outputTokens || 0,
    }
  }

  return {
    ok: true as const,
    data: profile,
    inputTokens: completion.inputTokens || 0,
    outputTokens: completion.outputTokens || 0,
  }
}

export function parseCommercialProfileResponse(content: string): CommercialProfile | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const summary = cleanString(parsed.summary, 700)
    const summaryWords = summary.split(/\s+/).filter(Boolean).length

    if (summaryWords < MIN_SUMMARY_WORDS || summaryWords > MAX_SUMMARY_WORDS) return null

    return {
      summary,
      industry: cleanString(parsed.industry, 100),
      business_category: cleanString(parsed.business_category, 100),
      primary_service: cleanString(parsed.primary_service, 200),
      core_services: cleanStringArray(parsed.core_services, 5, 120),
      target_customer: cleanString(parsed.target_customer, 200),
      competitive_advantage: cleanString(parsed.competitive_advantage, 300),
      keywords: cleanStringArray(parsed.keywords, 10, 80),
      generated_at: new Date().toISOString(),
    }
  } catch {
    return null
  }
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
