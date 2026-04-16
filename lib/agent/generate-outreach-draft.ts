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

function buildPrompt(params: GenerateParams): string {
  const { company_name, audience_input, location_input, mission_cta, offer, angles, context, offer_context } = params

  // Only use real enriched data — never hallucinate context
  const contextBlock = context.enriched && (context.h1 || context.title || context.description)
    ? `REAL WEBSITE DATA (you MUST use this to write line 1 — do not ignore it):
- Page headline: "${context.h1 || context.title || ''}"
- Description: "${context.description || ''}"
Use a specific detail from this data in line 1. If unusable, fall back to company name only.`
    : `No website data. Use company name "${company_name}" and audience type "${audience_input}" for line 1. Do not invent context.`

  const offerBlock = offer_context
    ? `What we do: ${offer_context.what_you_do}
Who we help: ${offer_context.who_you_help}
Main benefit: ${offer_context.main_benefit}
Angle: ${offer_context.angle}`
    : offer

  const angleHint = angles.length > 0
    ? `Messaging angle (use if it fits naturally): ${angles[0]}`
    : ''

  const locationHint = location_input
    ? `Location context (mention only if natural): ${location_input}`
    : ''

  const ctaInstruction = mission_cta
    ? `Line 4 — CTA: Copy this string EXACTLY with zero changes: "${mission_cta}"
Do NOT rephrase, shorten, expand, or vary this string in any way.`
    : `CTA: OMIT ENTIRELY. Do not write any call to action. Do not invent one.`

  const ctaJsonInstruction = mission_cta
    ? `"${mission_cta}"`
    : `""`

  return `You are writing a short, human cold email. Output ONLY valid JSON. No markdown, no preamble.

MISSION INPUTS — use ONLY these, do not add anything:
- Company: ${company_name}
- Audience: ${audience_input}
${locationHint}
${angleHint}

${contextBlock}

OFFER (copy precisely, do not expand):
${offerBlock}

EMAIL STRUCTURE — 3 paragraphs maximum, no filler:

Paragraph 1 (observation): One conversational sentence grounded in real data.
  - If website data exists above: reference a specific detail from it.
  - If no data: reference company name + audience type naturally.
  - NO generic observations. NO "I came across your company". NO "I noticed your website".
  - Good examples:
      "Your headline about [specific thing from website] caught my attention."
      "[Company] working with [audience] in [location] — quick question."
      "Saw [Company] is focused on [specific detail from headline]."

Paragraph 2 (pain): One sharp sentence naming the bottleneck this audience faces.
  - Must be specific to ${audience_input}, not "businesses in general".
  - Focus on: time lost, unpredictable pipeline, over-reliance on referrals, missed opportunities.
  - NO: "many businesses", "most companies", "boost your outreach", "increase efficiency", "streamline".

Paragraph 3 (offer): One sentence — what we solve, grounded in the offer above.
  - Copy the benefit from the offer. Do not invent a new one.

${ctaInstruction}

HARD RULES:
- Total word count: 60–90 words (body only, excluding subject and CTA)
- Subject line: max 7 words, no "Boost X" patterns, title-case, relevant to paragraph 1
- Every sentence starts with a capital letter
- No invented CTAs under any circumstances
- No corporate jargon
- No invented location references

BANNED PHRASES (never use):
"I noticed your company", "I came across your website", "I came across your business",
"I wanted to reach out", "I hope this finds you", "most people I talk to",
"many businesses", "companies like yours", "businesses like yours",
"boost your outreach", "increase efficiency", "streamline your workflow",
"take your business to the next level", "would you like a demo",
"globally", any invented CTA

OUTPUT — strict JSON, no other text:
{
  "subject": "<max 7 words, title-case>",
  "hook": "<paragraph 1 only>",
  "body": "<paragraphs 1–3 joined with double newlines>",
  "cta": ${ctaJsonInstruction},
  "personalization_score": <integer 0–5>,
  "quality_score": <integer 0–5>
}

Scoring:
- personalization_score: +2 if website headline/description used, +2 if company name used naturally, +1 if location mentioned
- quality_score: +2 if under 90 words, +2 if CTA is exact match (or no CTA required), +1 if no banned phrases`
}

/**
 * Build full_email from components — never trust AI to format this correctly.
 * Structure: body\n\n{cta}\n\n—\n{signature}
 */
function buildFullEmail(body: string, cta: string | null, signature: string | null): string {
  let parts = [body]
  if (cta) parts.push(cta)
  let result = parts.join('\n\n')
  if (signature) result = `${result}\n\n—\n${signature}`
  return result
}

function fallbackDraft(company_name: string, mission_cta: string | null, sender_signature: string | null): OutreachDraft {
  const name = company_name || 'your company'
  const hook = `${name} — quick question about your current lead flow.`
  const body = `${hook}\n\nMost ${name.toLowerCase().includes('agency') ? 'agencies' : 'teams'} we work with hit a wall when referrals slow down and there's no consistent way to fill the gap.\n\nWe help fix that with a predictable outbound system built around your exact audience.`
  const cta = mission_cta ?? ''
  return {
    subject: `Quick Question for ${name}`,
    hook,
    body,
    cta,
    full_email: buildFullEmail(body, cta || null, sender_signature),
    personalization_score: 1,
    quality_score: 1,
  }
}

export async function generateOutreachDraft(params: GenerateParams): Promise<OutreachDraft> {
  const companyName = params.company_name || 'your company'
  const missionCta = params.mission_cta ?? null
  const senderSignature = params.sender_signature ?? null
  const prompt = buildPrompt({ ...params, company_name: companyName })

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You output ONLY valid JSON. No markdown, no explanation, no code fences. Follow the structure exactly. Every field must be present.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.65,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0].message.content?.trim() || ''
    const parsed = JSON.parse(text) as Record<string, unknown>

    const subject = String(parsed.subject || '').trim().slice(0, 80)
    const body = String(parsed.body || '').trim().slice(0, 600)

    // Hard safety: subject or body missing → fallback
    if (!subject || !body) {
      console.log('[generate-outreach-draft] missing subject/body, using fallback for', companyName)
      return fallbackDraft(companyName, missionCta, senderSignature)
    }

    // CTA enforcement: if mission has CTA, AI must return exact string
    if (missionCta) {
      const generatedCta = String(parsed.cta || '').trim()
      if (generatedCta !== missionCta.trim()) {
        console.log('[generate-outreach-draft] CTA mismatch → fallback', {
          company: companyName,
          expected: missionCta,
          got: generatedCta,
        })
        return fallbackDraft(companyName, missionCta, senderSignature)
      }
    }

    const cta = missionCta ? missionCta.trim() : ''
    const hook = String(parsed.hook || '').trim().slice(0, 300)

    // Build full_email ourselves — ensures proper paragraph breaks and signature placement
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
    console.log('[generate-outreach-draft] error, using fallback for', companyName, err)
    return fallbackDraft(companyName, missionCta, senderSignature)
  }
}
