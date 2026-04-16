import { openai } from '@/lib/ai/openai'
import type { LeadContext } from '@/lib/agent/enrich-context'

export type OutreachDraft = {
  subject: string
  hook: string
  body: string
  cta: string
  full_email: string
  personalization_score: number
  quality_score: number
}

type OfferContext = {
  what_you_do: string
  who_you_help: string
  main_benefit: string
  angle: string
}

type GenerateParams = {
  company_name: string
  audience_input: string
  location_input: string | null
  mission_cta: string | null
  sender_signature: string | null
  offer: string
  angles: string[]
  context: LeadContext
  offer_context?: OfferContext | null
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(params: GenerateParams): string {
  const { company_name, audience_input, location_input, mission_cta, offer, offer_context, context } = params

  const companyRef = context.enriched && (context.h1 || context.title)
    ? `${company_name} (headline: "${context.h1 || context.title}")`
    : company_name

  const offerDescription = offer_context
    ? `${offer_context.what_you_do}. Helps ${offer_context.who_you_help}. Key benefit: ${offer_context.main_benefit}.`
    : offer

  const ctaInstruction = mission_cta
    ? `Line 4 — CTA: Use this string EXACTLY, word for word: "${mission_cta}"`
    : `No CTA. End after line 3.`

  const ctaJson = mission_cta ? `"${mission_cta}"` : `""`

  const locationNote = location_input ? ` in ${location_input}` : ''

  return `You are writing a short cold email on behalf of ALPA — a lead generation tool that finds business leads instantly (with website, email, and phone number).

The recipient is: ${companyRef}
Their audience type: ${audience_input}${locationNote}

PRODUCT BEING OFFERED:
${offerDescription}

EMAIL STRUCTURE — follow this pattern exactly:

Line 1 (opening): A short curiosity-driven question about how they currently find clients.
  - Personalise to their business type using the company name or audience type.
  - Examples:
      "Quick one for [Company] — how are you currently finding new clients?"
      "How does [Company] currently build its client pipeline?"
      "Quick question — how is [Company] finding new [audience type] clients right now?"
  - NEVER say: "your headline caught my attention", "I noticed your website", "I came across"

Line 2 (problem): One sentence on why manual lead sourcing is slow or unpredictable.
  - Make it specific to their audience type: ${audience_input}
  - Examples:
      "Most [audience type] still rely on referrals or manual search — which makes the pipeline unpredictable."
      "Finding [audience type] clients manually eats time and gives no guarantees."
  - NEVER say: "many businesses", "most companies", "boost efficiency", "streamline"

Line 3 (solution): One sentence describing what ALPA does.
  - Must be grounded in the offer above. Do not invent features.
  - Examples:
      "We built a tool that finds [audience type] leads in seconds — with website, email, and phone included."
      "ALPA pulls [audience type] leads instantly — website, email, phone — so you can reach out the same day."

${ctaInstruction}

RULES:
- Total body word count: 50–80 words (lines 1–3 only, not counting CTA or subject)
- Subject: max 6 words, no "Boost X" patterns, title-case, relevant to the opening
- Conversational tone — slightly informal, no buzzwords, no long paragraphs
- Each line is its own short paragraph (separated by blank line)
- Never invent a CTA if none is specified

OUTPUT — valid JSON only, no markdown, no preamble:
{
  "subject": "<max 6 words, title-case>",
  "hook": "<line 1 only>",
  "body": "<lines 1–3 joined with double newlines>",
  "cta": ${ctaJson},
  "personalization_score": <integer 0–5>,
  "quality_score": <integer 0–5>
}

Scoring:
- personalization_score: +2 if company name used in line 1, +2 if audience type used in line 2, +1 if location mentioned
- quality_score: +2 if under 80 words, +2 if CTA is exact match (or none required), +1 if tone is conversational with no jargon`
}

// ─── Post-process ─────────────────────────────────────────────────────────────

/**
 * Remove duplicate paragraphs and ensure the CTA appears exactly once.
 */
function cleanBody(body: string, cta: string | null): string {
  // Split into paragraphs, deduplicate by normalised content
  const paragraphs = body.split(/\n\n+/)
  const seen = new Set<string>()
  const deduped = paragraphs.filter((p) => {
    const key = p.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })

  let result = deduped.join('\n\n')

  // Ensure CTA appears at most once in the body (it will be appended via buildFullEmail)
  if (cta) {
    const escaped = cta.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')
    const occurrences = [...result.matchAll(regex)]
    if (occurrences.length > 0) {
      // Strip all occurrences from the body — CTA lives in full_email only
      result = result.replace(regex, '').replace(/\n{3,}/g, '\n\n').trim()
    }
  }

  return result.trim()
}

// ─── Full email builder ───────────────────────────────────────────────────────

/**
 * Build full_email from components — never trust AI to format this correctly.
 * Structure: body\n\n{cta}\n\n—\n{signature}
 */
function buildFullEmail(body: string, cta: string | null, signature: string | null): string {
  const parts = [body]
  if (cta) parts.push(cta)
  let result = parts.join('\n\n')
  if (signature) result = `${result}\n\n—\n${signature}`
  return result
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function fallbackDraft(
  company_name: string,
  audience_input: string,
  mission_cta: string | null,
  sender_signature: string | null
): OutreachDraft {
  const name = company_name || 'your company'
  const audience = audience_input || 'clients'
  const hook = `Quick one for ${name} — how are you currently finding new ${audience}?`
  const body = [
    hook,
    `Most teams still rely on referrals or manual search — which makes the pipeline slow and unpredictable.`,
    `We built a tool that finds ${audience} leads in seconds — complete with website, email, and phone.`,
  ].join('\n\n')
  const cta = mission_cta ?? ''
  return {
    subject: `Finding New ${audience.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ')} Clients`,
    hook,
    body,
    cta,
    full_email: buildFullEmail(body, cta || null, sender_signature),
    personalization_score: 2,
    quality_score: 2,
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateOutreachDraft(params: GenerateParams): Promise<OutreachDraft> {
  const companyName = params.company_name || 'your company'
  const missionCta = params.mission_cta ?? null
  const senderSignature = params.sender_signature ?? null
  const audienceInput = params.audience_input || 'clients'
  const prompt = buildPrompt({ ...params, company_name: companyName })

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You output ONLY valid JSON. No markdown, no explanation, no code fences. Every field must be present.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0].message.content?.trim() || ''
    const parsed = JSON.parse(text) as Record<string, unknown>

    const subject = String(parsed.subject || '').trim().slice(0, 80)
    const rawBody = String(parsed.body || '').trim().slice(0, 600)

    if (!subject || !rawBody) {
      console.log('[generate-outreach-draft] missing subject/body → fallback', { company: companyName })
      return fallbackDraft(companyName, audienceInput, missionCta, senderSignature)
    }

    // CTA enforcement: AI must return exact string
    if (missionCta) {
      const generatedCta = String(parsed.cta || '').trim()
      if (generatedCta !== missionCta.trim()) {
        console.log('[generate-outreach-draft] CTA mismatch → fallback', {
          company: companyName,
          expected: missionCta,
          got: generatedCta,
        })
        return fallbackDraft(companyName, audienceInput, missionCta, senderSignature)
      }
    }

    const cta = missionCta ? missionCta.trim() : ''
    const hook = String(parsed.hook || '').trim().slice(0, 300)

    // Clean body: remove duplicate paragraphs, strip CTA if AI embedded it
    const body = cleanBody(rawBody, cta || null)

    const full_email = buildFullEmail(body, cta || null, senderSignature)

    return {
      subject,
      hook,
      body,
      cta,
      full_email,
      personalization_score: Math.min(5, Math.max(0, Number(parsed.personalization_score ?? 0))),
      quality_score: Math.min(5, Math.max(0, Number(parsed.quality_score ?? 0))),
    }
  } catch (err) {
    console.log('[generate-outreach-draft] error → fallback', { company: companyName, err })
    return fallbackDraft(companyName, audienceInput, missionCta, senderSignature)
  }
}
