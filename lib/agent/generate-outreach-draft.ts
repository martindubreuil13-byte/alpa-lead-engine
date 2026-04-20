import { openai } from '@/lib/ai/openai'
import { inferAudience } from '@/lib/agent/infer-audience'
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

export type GenerateParams = {
  company_name: string
  audience_input: string
  location_input: string | null
  mission_cta: string | null
  sender_signature: string | null
  offer: string
  angles: string[]
  context: LeadContext
  offer_context?: OfferContext | null
  user_name?: string | null
  user_role?: string | null
  user_company?: string | null
  pain_solved?: string | null
  value_outcome?: string | null
  cta_type?: 'conversation' | 'link' | 'offer' | null
  cta_link?: string | null
  // Variation seed (0-2) — rotates tone, opener style, and sentence pattern
  variation_seed?: number
}

// ─── Opener styles ────────────────────────────────────────────────────────────

const OPENER_STYLES = [
  {
    name: 'assumption',
    instruction: 'Start with a direct assumption about how they currently get clients (e.g. "Most [type] I talk to still rely on referrals to fill their pipeline."). Be direct, not salesy.',
  },
  {
    name: 'observation',
    instruction: 'Start with a short, specific observation about a challenge in their space (e.g. "Client acquisition is still one of the hardest parts of running a [type]."). One sentence, grounded.',
  },
  {
    name: 'question',
    instruction: 'Open with a natural, low-pressure question about how they currently bring in new clients. Not "Quick question" — be specific to their business type.',
  },
]

const TONE_VARIANTS = [
  'Direct and concise. Short sentences. No fluff.',
  'Conversational and peer-to-peer. Like a professional reaching out to a peer they respect.',
  'Crisp and confident. Matter-of-fact. No hype.',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractUserName(signature: string | null | undefined): string | null {
  if (!signature) return null
  const cleaned = signature.replace(/^[-—\s]+/, '').trim()
  const firstLine = cleaned.split(/[\n,|]/)[0]?.trim() ?? ''
  const firstWord = firstLine.split(/\s+/)[0] ?? ''
  return firstWord.length >= 2 ? firstWord : null
}

function resolveCtaShape(params: GenerateParams): {
  type: 'conversation' | 'link' | 'offer' | 'none'
  text: string
  link: string | null
} {
  const { mission_cta, cta_type, cta_link } = params

  if (!mission_cta) return { type: 'none', text: '', link: null }

  const ctaText = mission_cta.trim()
  const urlMatch = ctaText.match(/https?:\/\/[^\s]+/)

  const type: 'conversation' | 'link' | 'offer' =
    cta_type ??
    (urlMatch || cta_link
      ? 'link'
      : /\?|worth|happy|open|curious|quick|chat|call|meet/i.test(ctaText)
      ? 'conversation'
      : 'offer')

  const link = cta_link ?? urlMatch?.[0] ?? null

  return { type, text: ctaText, link }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(params: GenerateParams): string {
  const { company_name, audience_input, location_input, offer, offer_context, context } = params

  const seed = (params.variation_seed ?? 0) % 3
  const openerStyle = OPENER_STYLES[seed]!
  const tone = TONE_VARIANTS[seed]!

  // ── Lead context
  const websiteStr = context.website || 'Not available'
  const contextLines = [
    context.h1 && `H1: ${context.h1}`,
    context.title && `Title: ${context.title}`,
    context.description && `Description: ${context.description}`,
  ].filter(Boolean)
  const contextStr = contextLines.length > 0 ? contextLines.join('\n') : 'No website data available.'

  // ── User identity
  const userName = params.user_name ?? extractUserName(params.sender_signature) ?? 'the sender'
  const userRole = params.user_role ?? null
  const userCompany =
    params.user_company ??
    offer_context?.what_you_do?.split(' ').slice(0, 3).join(' ') ??
    null
  const userLines = [
    `Name: ${userName}`,
    userRole && `Role: ${userRole}`,
    userCompany && `Company: ${userCompany}`,
  ]
    .filter(Boolean)
    .join('\n')

  // ── Offer framing
  const offerStr = offer_context ? offer_context.what_you_do : offer
  const painStr =
    params.pain_solved ?? offer_context?.angle ?? 'manual, time-consuming lead generation'
  const outcomeStr =
    params.value_outcome ?? offer_context?.main_benefit ?? 'generates consistent pipeline results'

  // ── Who the lead serves (inferred — NOT audience_input itself)
  const inferredAudience = inferAudience(audience_input)
  const audienceContext = [audience_input, location_input].filter(Boolean).join(' in ')

  // ── CTA instruction
  const cta = resolveCtaShape(params)
  let ctaInstruction: string
  if (cta.type === 'none') {
    ctaInstruction = 'No CTA. End after the solution line.'
  } else if (cta.type === 'conversation') {
    ctaInstruction = `CTA type: conversation\nUse this exact text: "${cta.text}"`
  } else if (cta.type === 'link') {
    const linkDisplay = cta.link ?? ''
    const ctaDisplayText = cta.text.replace(linkDisplay, '').trim() || cta.text
    ctaInstruction = `CTA type: link\nText: "${ctaDisplayText}"\nLink: ${linkDisplay}\nFormat: text followed by the link on the same line.`
  } else {
    ctaInstruction = `CTA type: offer\nSoft close — no link. Keep it light: "Happy to show you how it works." or similar.`
  }

  return `You are writing a cold email on behalf of ${userName}.

---------------------------------------
LEAD
---------------------------------------
Company: ${company_name}
Type: ${audience_input}
Website: ${websiteStr}
Context:
${contextStr}

---------------------------------------
SENDER
---------------------------------------
${userLines}

Offer: ${offerStr}
Pain addressed: ${painStr}
Outcome delivered: ${outcomeStr}
Target audience context: ${audienceContext}

---------------------------------------
WHO THIS LEAD SERVES
---------------------------------------
This lead is a ${audience_input}.
They serve: ${inferredAudience}

Use "${inferredAudience}" (or a natural variation like "their ${inferredAudience.split(',')[0]?.trim()}")
when referring to who the lead sells to.

NEVER use "${audience_input}" inside the body — it describes the lead, not their customers.

---------------------------------------
BANNED PHRASES (instant fail)
---------------------------------------
- "quick question"
- "I came across"
- "I noticed your company"
- "your website caught my attention"
- "[audience_input] clients"  (e.g. "marketing agencies clients")
- "finding [audience_input]"
- Any phrase that uses the lead category as if it were their customer type

---------------------------------------
OPENER STYLE: ${openerStyle.name.toUpperCase()}
---------------------------------------
${openerStyle.instruction}

---------------------------------------
TONE
---------------------------------------
${tone}

---------------------------------------
CTA
---------------------------------------
${ctaInstruction}

---------------------------------------
STRUCTURE (follow exactly)
---------------------------------------
1. Opener — ${openerStyle.instruction}
2. Relevance — one sentence that shows you understand what they do (skip if no context)
3. Problem — the real pain around getting new ${inferredAudience.split(',')[0]?.trim() ?? 'clients'} (time, inconsistency, unpredictability)
4. Solution — one sentence using the offer above (NOT a generic description)
5. CTA — as specified, once, at the end

---------------------------------------
RULES
---------------------------------------
- 80–120 words (body only, no subject)
- Each email must read like it was written manually for this specific company
- If two emails look similar, this one is wrong — vary the structure
- No corporate language, no "I hope this finds you well", no passive voice
- Only reference context details that are actually present above
- If context is weak: go straight to problem → solution, no fake personalization

---------------------------------------
OUTPUT FORMAT
---------------------------------------
Return ONLY valid JSON, no markdown, no explanation:
{
  "subject": "<3–6 words, natural curiosity-driven — no ALL CAPS, no clickbait>",
  "body": "<complete email body — paragraphs separated by \\n\\n — CTA on its own line at the end>"
}`
}

// ─── Post-process ─────────────────────────────────────────────────────────────

function isEmailContaminated(body: string, audienceInput: string): boolean {
  if (!audienceInput) return false
  const label = audienceInput.toLowerCase().trim()
  const lower = body.toLowerCase()
  return (
    lower.includes(`${label} clients`) ||
    lower.includes(`${label} leads`) ||
    lower.includes(`${label} customers`) ||
    lower.includes(`finding ${label}`) ||
    lower.includes(`for ${label}`) ||
    lower.includes(`clients for ${label}`) ||
    lower.includes(`leads for ${label}`) ||
    lower.includes('quick question')
  )
}

function isGenericTemplate(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('i came across') ||
    lower.includes('your website caught my attention') ||
    lower.includes('i noticed your company') ||
    lower.includes('i hope this finds you') ||
    lower.includes('i wanted to reach out') ||
    lower.includes('touching base')
  )
}

function cleanBody(body: string): string {
  const paragraphs = body.split(/\n\n+/)
  const seen = new Set<string>()
  const deduped = paragraphs.filter((p) => {
    const key = p.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return deduped.join('\n\n').trim()
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function fallbackDraft(params: GenerateParams): OutreachDraft {
  const companyName = params.company_name || 'there'
  const senderName =
    params.user_name ??
    extractUserName(params.sender_signature) ??
    'Best'
  const defaultCta = 'Would you be open to a quick 10-minute chat?'
  const hook = `Hi ${companyName},`
  const body = [
    hook,
    'I came across your business and thought there could be an opportunity to connect.',
    'Would you be open to a quick conversation to explore potential collaboration?',
    senderName,
  ].join('\n\n')
  const full_email = body
  const cta = params.mission_cta?.trim() || defaultCta

  return {
    subject: `Quick idea for ${companyName}`,
    hook,
    body,
    cta,
    full_email,
    personalization_score: 1,
    quality_score: 2,
  }
}

// ─── Core call ────────────────────────────────────────────────────────────────

async function callOpenAI(prompt: string): Promise<{ subject: string; body: string } | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content:
            'You output ONLY valid JSON. No markdown, no explanation, no code fences. Every field must be present.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.72,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0]?.message.content?.trim() || ''
    const parsed = JSON.parse(text) as Record<string, unknown>

    const subject = String(parsed.subject || '').trim().slice(0, 80)
    const body = String(parsed.body || '').trim().slice(0, 900)

    if (!subject || !body) return null
    return { subject, body }
  } catch {
    return null
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateOutreachDraft(params: GenerateParams): Promise<OutreachDraft> {
  try {
    const missionCta = params.mission_cta ?? null
    const senderSignature = params.sender_signature ?? null
    const cta = resolveCtaShape(params)
    const maxRetries = 2
    let result: { subject: string; body: string } | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const prompt = buildPrompt({
        ...params,
        variation_seed: ((params.variation_seed ?? 0) + attempt) % 3,
      })

      result = await callOpenAI(prompt)
      if (result?.subject && result.body) {
        break
      }
    }

    if (!result?.subject || !result.body) {
      console.log('[generate-outreach-draft] fallback after retries', { company: params.company_name })
      return fallbackDraft(params)
    }

    let body = cleanBody(result.body)
    const subject = String(result.subject || '').trim().slice(0, 80) || fallbackDraft(params).subject

    if (!body) {
      return fallbackDraft(params)
    }

    if (missionCta && !body.includes(missionCta.trim())) {
      body = `${body}\n\n${missionCta.trim()}`
    } else if (!missionCta && !cta.text) {
      body = `${body}\n\nWould you be open to a quick 10-minute chat?`
    }

    const hook = body.split('\n\n')[0]?.trim() ?? ''

    const full_email = senderSignature ? `${body}\n\n—\n${senderSignature}` : body

    const wordCount = body.split(/\s+/).length
    const hasRealContext =
      params.context.enriched && Boolean(params.context.h1 || params.context.description)
    const personalization_score = hasRealContext ? 4 : 2
    const quality_score = wordCount <= 120 ? (wordCount >= 60 ? 4 : 3) : 2

    return {
      subject,
      hook,
      body,
      cta: cta.text || 'Would you be open to a quick 10-minute chat?',
      full_email,
      personalization_score,
      quality_score,
    }
  } catch (error) {
    console.error('[generate-outreach-draft] failed, returning fallback', error)
    return fallbackDraft(params)
  }
}
