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

  const contextBlock = context.enriched
    ? `Website context (use this to personalize line 1):
- Headline: "${context.h1 || context.title}"
- Description: "${context.description}"`
    : `No website data available. Use company name and audience type to personalize.`

  const offerBlock = offer_context
    ? `What we do: ${offer_context.what_you_do}
Who we help: ${offer_context.who_you_help}
Main benefit: ${offer_context.main_benefit}
Angle: ${offer_context.angle}`
    : offer

  const angleList = angles.length > 0
    ? angles.slice(0, 2).map((a) => `- ${a}`).join('\n')
    : `- Help ${audience_input} work smarter`

  const ctaInstruction = mission_cta
    ? `Line 4 (CTA): Copy this text EXACTLY, no changes: "${mission_cta}"`
    : `Line 4: OMIT — no CTA line at all`

  const ctaFieldInstruction = mission_cta
    ? `"${mission_cta}" — exact copy, no variation`
    : `"" — empty string, no CTA`

  const locationLine = location_input
    ? `- Mention "${location_input}" naturally if relevant (e.g. "working with ${audience_input} in ${location_input}")`
    : `- No location available, skip location reference`

  return `You write strict cold outreach emails. Every word must come from the mission inputs below. You may not invent positioning, benefits, or CTAs. Output ONLY valid JSON.

TARGET:
- Company: ${company_name}
- Audience type: ${audience_input}
- Location: ${location_input || 'not specified'}

${contextBlock}

OFFER (use ONLY this — do not add to it or rephrase beyond clarity):
${offerBlock}

MESSAGING ANGLES:
${angleList}

STRUCTURE — 4 lines maximum, no filler between them:
Line 1 (hook): A conversational, slightly provocative opener that creates immediate recognition.
  - Frame a frustration, contradiction, or curious question specific to ${audience_input}
  - Optionally reference ${company_name} or ${location_input} to ground it
  - Examples of the RIGHT tone:
      "most ${audience_input}s I talk to spend more time chasing leads than doing actual work"
      "quick question — how are you currently finding new clients in ${location_input}?"
      "noticed you're operating in ${location_input} — curious how you're sourcing leads right now"
  - BANNED for line 1: "I noticed your company", "I came across your website", "I wanted to reach out", any neutral observation

Line 2 (pain): One sharp sentence that names the bottleneck — make it feel like you've seen this before.
  - Tie it directly to ${audience_input} — not generic businesses
  - Focus on: time waste, inconsistency, dependency on referrals, missed opportunities, or unpredictable pipeline
  - Examples of the RIGHT tone:
      "it usually ends up being manual, inconsistent, and a drain on actual billable time"
      "most end up relying on referrals or platforms, which makes pipeline completely unpredictable"
      "and it often becomes the bottleneck that slows everything else down"
  - BANNED for line 2: vague phrases, "many businesses struggle with", anything that could apply to any audience

Line 3 (offer): One sentence from the offer above — what it solves specifically for ${audience_input}.
${ctaInstruction}

LOCATION:
${locationLine}

BANNED PHRASES — never use any of these:
- "I noticed your company"
- "I came across your website"
- "I came across your business"
- "boost your outreach"
- "increase efficiency"
- "would you like a demo"
- "businesses like yours"
- "take your business to the next level"
- "I hope this finds you"
- "I wanted to reach out"
- "streamline your workflow"
- "many businesses"
- "companies like yours"
- any invented CTA not matching the provided one
- "globally" as a substitute for location

RULES:
- Body under 100 words
- Conversational, slightly challenging tone — not aggressive
- No corporate language
- Reader should feel "this is about me" after line 1
- No invented audience types beyond "${audience_input}"
- No invented CTAs

OUTPUT FORMAT (strict JSON):
{
  "subject": "short subject line, max 60 chars",
  "hook": "line 1 — observation sentence",
  "body": "lines 1–3 as a flowing paragraph",
  "cta": ${ctaFieldInstruction},
  "full_email": "complete email body${mission_cta ? ' ending with the exact CTA' : ', no CTA line'}",
  "personalization_score": <0-5 integer>,
  "quality_score": <0-5 integer>
}

Scoring guide:
- personalization_score: +2 company name used, +2 website context used, +1 location mentioned
- quality_score: +2 under 100 words, +2 CTA is exact match (or 0 if no CTA provided), +1 no banned phrases`
}

function fallbackDraft(company_name: string, mission_cta: string | null, sender_signature: string | null): OutreachDraft {
  const hook = `I came across ${company_name} and had a quick question.`
  const body = `We help ${company_name === 'your company' ? 'professionals' : company_name} cut through the noise and reach the right people — without the guesswork.`
  const cta = mission_cta ?? ''
  let full_email = cta ? `${hook}\n\n${body}\n\n${cta}` : `${hook}\n\n${body}`
  if (sender_signature) full_email = `${full_email}\n\n${sender_signature}`
  return {
    subject: `Quick question for ${company_name}`,
    hook,
    body,
    cta,
    full_email,
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
        { role: 'system', content: 'You output ONLY valid JSON. No markdown. No explanation. Follow the structure exactly.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 450,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0].message.content?.trim() || ''
    const parsed = JSON.parse(text) as Partial<OutreachDraft>

    const subject = String(parsed.subject || '').trim().slice(0, 120)
    const body = String(parsed.body || '').trim().slice(0, 600)

    // Subject or body missing → fallback
    if (!subject || !body) {
      console.log('[generate-outreach-draft] missing subject/body, fallback for', companyName, { subject, body })
      return fallbackDraft(companyName, missionCta, senderSignature)
    }

    // CTA validation: if mission has a CTA, the AI must return it exactly
    if (missionCta) {
      const generatedCta = String(parsed.cta || '').trim()
      if (generatedCta !== missionCta.trim()) {
        console.log('[generate-outreach-draft] CTA mismatch, fallback for', companyName, {
          expected: missionCta,
          got: generatedCta,
        })
        return fallbackDraft(companyName, missionCta, senderSignature)
      }
    }

    const cta = missionCta ? missionCta.trim() : ''
    let full_email = String(parsed.full_email || '').slice(0, 1200) || (cta ? `${body}\n\n${cta}` : body)

    // Append sender signature — never generated by AI, always appended literally
    if (senderSignature) full_email = `${full_email}\n\n${senderSignature}`

    return {
      subject,
      hook: String(parsed.hook || '').slice(0, 400),
      body,
      cta,
      full_email,
      personalization_score: Number(parsed.personalization_score ?? 0),
      quality_score: Number(parsed.quality_score ?? 0),
    }
  } catch (err) {
    console.log('[generate-outreach-draft] threw, fallback for', companyName, err)
    return fallbackDraft(companyName, missionCta, senderSignature)
  }
}
