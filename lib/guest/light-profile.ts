// A short, factual profile for a free-trial business: one 25-40 word paragraph and up to five service tags, written from the
// business's own website words that the search already stored (title, description, headings). It never fetches anything, never
// adds facts the website did not state, and is refused when the stored words are too few to support it.
//
// This is deliberately separate from the paid Business Intelligence engine (lib/commercial-intelligence): different inputs
// (stored words, not fetched pages), different output, no queue, no lead row. Only the model and the "state only what is supplied"
// rule are shared.

export const LIGHT_PROFILE_VERSION = 1
export const LIGHT_PROFILE_MODEL = 'gpt-4o-mini'

export const LIGHT_PROFILE_LIMITS = {
  /** Profiles one free trial may have generated (the trial holds at most 25 businesses). */
  maxProfilesPerTrial: 25,
  /** Generation attempts one trial may use, including failed ones, so retries cannot run up cost. */
  maxAttemptsPerTrial: 40,
  /** Profiles all free trials together may generate per UTC day (a shared ceiling enforced by the database). */
  dailyCeiling: 1000,
  /** Fewest words of stored website text needed to write a profile. */
  minEvidenceWords: 30,
  /** Most characters of website text sent to the model (about 300 tokens). */
  maxEvidenceChars: 1200,
  maxOutputTokens: 160,
  /** The model call is bounded: no retries, and the whole request gives up after this long. */
  timeoutMs: 15_000,
  minSummaryWords: 25,
  maxSummaryWords: 40,
  maxTags: 5,
} as const

export type LightProfile = {
  version: 1
  summary: string
  tags: string[]
  generated_at: string
  model: string
}

export type WebsiteText = { title?: string | null; description?: string | null; headings?: string[] | null } | null | undefined

const squash = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const wordsOf = (value: string) => value.split(/\s+/).filter(Boolean)

/** The website words available for a profile, capped, in the order title, description, headings. */
export function profileEvidence(facts: WebsiteText): { text: string; words: number } {
  const parts = [
    squash(facts?.title, 200),
    squash(facts?.description, 400),
    ...(Array.isArray(facts?.headings) ? facts!.headings!.slice(0, 8).map((heading) => squash(heading, 150)) : []),
  ].filter(Boolean)
  const text = parts.join('. ').slice(0, LIGHT_PROFILE_LIMITS.maxEvidenceChars)
  return { text, words: wordsOf(text).length }
}

export function hasEnoughEvidence(facts: WebsiteText): boolean {
  return profileEvidence(facts).words >= LIGHT_PROFILE_LIMITS.minEvidenceWords
}

export function buildLightProfilePrompt(companyName: string, evidence: string): string {
  return `
Business name: ${squash(companyName, 120)}

Text published on the business's own website (the only source of truth):
${evidence}

Return only valid JSON in exactly this shape:
{"summary": "...", "tags": ["..."]}

Rules:
- "summary" is one paragraph of 25 to 40 words saying what the business does.
- "tags" is up to five short service or product names (one to three words each) that the text explicitly mentions.
- Use only facts stated in the text. Do not infer customers, size, location, quality, experience or any differentiator.
- Do not use promotional language. Do not include numbers, web addresses or email addresses unless they appear in the text.
- If something is not stated, leave it out. Never fill a gap.
`.trim()
}

const stem = (word: string) => word.toLowerCase().replace(/[^a-z0-9À-ɏ]/g, '').slice(0, 5)

/**
 * Reads the model's answer and keeps it only if it is well formed and stays within the evidence: 25-40 words, no figures or
 * addresses the text did not contain, most of its distinctive words present in the text, and tags that the text mentions.
 * This is a guard against drift, not a proof; the screen labels the result as AI-written and not independently verified.
 */
export function parseLightProfile(content: string, evidence: string, companyName: string, now: Date = new Date()): LightProfile | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const summary = squash((raw as { summary?: unknown }).summary, 600)
  const count = wordsOf(summary).length
  if (count < LIGHT_PROFILE_LIMITS.minSummaryWords || count > LIGHT_PROFILE_LIMITS.maxSummaryWords) return null

  const known = `${evidence} ${companyName}`.toLowerCase()
  if (/https?:|www\.|@/.test(summary) && !/https?:|www\.|@/.test(known)) return null
  const figures = summary.match(/\d[\d.,]*/g) ?? []
  if (figures.some((figure) => !known.includes(figure.replace(/[.,]$/, '').toLowerCase()))) return null

  const knownStems = new Set(wordsOf(known).map(stem).filter(Boolean))
  const distinctive = wordsOf(summary).filter((word) => word.replace(/[^\p{L}\p{N}]/gu, '').length >= 6)
  if (distinctive.length > 0) {
    const grounded = distinctive.filter((word) => knownStems.has(stem(word))).length
    if (grounded / distinctive.length < 0.5) return null
  }

  const tags: string[] = []
  const seen = new Set<string>()
  for (const candidate of Array.isArray((raw as { tags?: unknown }).tags) ? ((raw as { tags: unknown[] }).tags) : []) {
    const tag = squash(candidate, 40)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key) || wordsOf(tag).length > 3 || /https?:|www\.|@|\d/.test(tag)) continue
    // a tag stays only if the website's words contain it (by word stem), so a tag cannot add a service the text never mentioned
    if (!wordsOf(tag).filter((word) => word.length >= 3).every((word) => knownStems.has(stem(word)))) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length === LIGHT_PROFILE_LIMITS.maxTags) break
  }
  return { version: LIGHT_PROFILE_VERSION, summary, tags, generated_at: now.toISOString(), model: LIGHT_PROFILE_MODEL }
}

/** A stored value read back safely (a customer may edit their own rows): anything not a clean profile is null. */
export function readStoredLightProfile(value: unknown): LightProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const summary = squash(raw.summary, 600)
  if (raw.version !== LIGHT_PROFILE_VERSION || !summary) return null
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).map((tag) => squash(tag, 40)).filter(Boolean).slice(0, LIGHT_PROFILE_LIMITS.maxTags)
  const generated = typeof raw.generated_at === 'string' && Number.isFinite(Date.parse(raw.generated_at)) ? new Date(raw.generated_at).toISOString() : new Date(0).toISOString()
  return { version: LIGHT_PROFILE_VERSION, summary, tags, generated_at: generated, model: squash(raw.model, 60) || LIGHT_PROFILE_MODEL }
}

export type LightProfileCompletion = (prompt: string) => Promise<{ content: string; inputTokens?: number; outputTokens?: number }>

/** Cost in US dollars of one call at gpt-4o-mini list prices; an estimate for reporting and tests. */
export function estimateLightProfileCost(inputTokens: number, outputTokens: number) {
  return inputTokens * 0.00000015 + outputTokens * 0.0000006
}

export type LightProfileResult =
  | { ok: true; profile: LightProfile; inputTokens: number; outputTokens: number }
  | { ok: false; reason: 'insufficient' | 'invalid' | 'failed'; inputTokens: number; outputTokens: number }

/** Writes one profile from stored website words. The completion is injected so tests never reach a paid service. */
export async function generateLightProfile(
  input: { companyName: string; facts: WebsiteText },
  complete: LightProfileCompletion
): Promise<LightProfileResult> {
  const evidence = profileEvidence(input.facts)
  if (evidence.words < LIGHT_PROFILE_LIMITS.minEvidenceWords) return { ok: false, reason: 'insufficient', inputTokens: 0, outputTokens: 0 }
  try {
    const completion = await complete(buildLightProfilePrompt(input.companyName, evidence.text))
    const profile = parseLightProfile(completion.content, evidence.text, input.companyName)
    const inputTokens = completion.inputTokens ?? 0
    const outputTokens = completion.outputTokens ?? 0
    return profile ? { ok: true, profile, inputTokens, outputTokens } : { ok: false, reason: 'invalid', inputTokens, outputTokens }
  } catch {
    return { ok: false, reason: 'failed', inputTokens: 0, outputTokens: 0 }
  }
}
