import { openai } from '@/lib/ai/openai'
import { inferAudience } from '@/lib/agent/infer-audience'
import type { LeadContext } from '@/lib/agent/enrich-context'

export type OutreachDraft = {
  subject: string
  hook: string
  body: string
  cta: string
  full_email: string
  style: DraftStyle
  personalization_score: number
  quality_score: number
}

export type DraftStyle = 'provocative' | 'curious' | 'insight' | 'direct' | 'soft'

type OfferContext = {
  what_you_do: string
  who_you_help: string
  main_benefit: string
  angle: string
}

export type GenerateParams = {
  company_name: string
  industry?: string | null
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
  // Variation seed — rotates style and sentence pattern
  variation_seed?: number
}

const STYLE_PROFILES = [
  {
    key: 'provocative',
    label: 'PROVOCATIVE',
    instruction:
      'Start by challenging the slow or outdated way teams usually handle outreach. Create tension fast. Position ALPA as an unfair speed advantage without sounding hyped.',
  },
  {
    key: 'curious',
    label: 'CURIOUS QUESTION',
    instruction:
      'Open with a sharp question about how they source pipeline or new clients today. The question should expose a gap or inefficiency immediately.',
  },
  {
    key: 'insight',
    label: 'INSIGHT-DRIVEN',
    instruction:
      'Lead with a specific observation about the industry or market, then connect it to a hidden prospecting problem or response-time gap.',
  },
  {
    key: 'direct',
    label: 'DIRECT / BLUNT',
    instruction:
      'Be straight to the point. No story, no warm-up, no explanation-heavy lead-in. Short, confident sentences.',
  },
  {
    key: 'soft',
    label: 'SOFT / CONSULTATIVE',
    instruction:
      'Low-pressure, peer-to-peer tone. Sound helpful and observant, not pushy. Still keep the hook sharp and non-generic.',
  },
] as const satisfies Array<{ key: DraftStyle; label: string; instruction: string }>

const CTA_OPTIONS = [
  'Want me to show you?',
  'Curious to see how it works?',
  'Worth testing?',
]

const BANNED_BODY_PATTERNS = [
  /love what you do/gi,
  /i came across/gi,
  /i noticed your company/gi,
  /your website caught my attention/gi,
  /i hope this finds you well/gi,
  /quick question/gi,
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractUserName(signature: string | null | undefined): string | null {
  if (!signature) return null
  const cleaned = signature.replace(/^[-—\s]+/, '').trim()
  const firstLine = cleaned.split(/[\n,|]/)[0]?.trim() ?? ''
  const firstWord = firstLine.split(/\s+/)[0] ?? ''
  return firstWord.length >= 2 ? firstWord : null
}

function pickRandom<T>(items: readonly T[], seed?: number): T {
  if (items.length === 0) {
    throw new Error('pickRandom requires at least one item')
  }
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return items[Math.abs(seed) % items.length]!
  }
  return items[Math.floor(Math.random() * items.length)]!
}

function resolveCtaShape(params: GenerateParams): {
  type: 'conversation' | 'link' | 'offer' | 'none'
  text: string
  link: string | null
} {
  const { mission_cta, cta_type, cta_link } = params
  const defaultCta = CTA_OPTIONS[(params.variation_seed ?? 0) % CTA_OPTIONS.length]!

  if (!mission_cta) {
    return { type: 'conversation', text: defaultCta, link: null }
  }

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
  const {
    company_name,
    industry,
    audience_input,
    location_input,
    offer,
    offer_context,
    context,
  } = params

  const style = pickRandom(STYLE_PROFILES, params.variation_seed)
  const seed = STYLE_PROFILES.findIndex((profile) => profile.key === style.key)

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
  const locationStr = location_input?.trim() || 'their market'
  const industryStr = industry?.trim() || audience_input.trim() || 'their space'

  // ── CTA instruction
  const cta = resolveCtaShape(params)
  let ctaInstruction: string
  if (cta.type === 'conversation') {
    ctaInstruction = `Use exactly one CTA, once, on its own final line: "${cta.text}"`
  } else if (cta.type === 'link') {
    const linkDisplay = cta.link ?? ''
    const ctaDisplayText = cta.text.replace(linkDisplay, '').trim() || cta.text
    ctaInstruction = `Use exactly one CTA, once, on its own final line.\nCTA text: "${ctaDisplayText}"\nLink: ${linkDisplay}\nFormat: text plus link on the same line.`
  } else {
    ctaInstruction = `Use exactly one CTA, once, on its own final line: "${cta.text || CTA_OPTIONS[seed % CTA_OPTIONS.length]}"`
  }

  return `You are writing a cold email on behalf of ${userName}.

LEAD
---------------------------------------
Company: ${company_name}
Industry: ${industryStr}
Type: ${audience_input}
Location: ${locationStr}
Website: ${websiteStr}
Lead context:
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
STYLE
---------------------------------------
Style: ${style.label}
${style.instruction}

---------------------------------------
HOOK REQUIREMENTS
---------------------------------------
- The first line must create curiosity, tension, or a sharp question
- No generic compliments
- No "we provide" or "we help" in the opening line
- No long setup
- Mention ${company_name} naturally somewhere in the email
- Adapt wording to ${industryStr} and ${locationStr} when useful

---------------------------------------
BANNED PHRASES (instant fail)
---------------------------------------
- "quick question"
- "I came across"
- "I noticed your company"
- "your website caught my attention"
- "love what you do"
- "we provide" in the opening line
- "[audience_input] clients"  (e.g. "marketing agencies clients")
- "finding [audience_input]"
- Any phrase that uses the lead category as if it were their customer type

CTA
---------------------------------------
${ctaInstruction}

---------------------------------------
STRUCTURE (follow exactly)
---------------------------------------
1. Hook — 1 to 2 short lines max. Must create curiosity or tension.
2. Pain / insight — 1 to 2 short lines exposing the hidden inefficiency, delay, or missed opportunity.
3. ALPA positioning — 1 to 2 short lines. Show the advantage clearly, without hype or long explanation.
4. CTA — 1 line only, once, at the end.

---------------------------------------
RULES
---------------------------------------
- 80–120 words in the body
- Subject must be under 6 words and curiosity-driven
- Short sentences. Natural human tone. No AI voice.
- No fluff. No long explanations. No buzzwords.
- One clear CTA only.
- Each email must feel distinct in rhythm and opening style.
- Only reference context details that are actually present above.
- If context is weak, do not fake personalization.
- Do not over-explain ALPA. Keep it punchy.

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

function normalizeSubject(subject: string, companyName: string) {
  const fallback = `${companyName} pipeline gap`
  const cleaned = String(subject || '')
    .replace(/\s+/g, ' ')
    .trim()
  const limitedWords = cleaned.split(' ').filter(Boolean).slice(0, 6).join(' ')
  return limitedWords || fallback.split(' ').slice(0, 6).join(' ')
}

function sanitizeBody(body: string) {
  let next = body
  for (const pattern of BANNED_BODY_PATTERNS) {
    next = next.replace(pattern, '')
  }
  return next.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function trimToWordLimit(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return value.trim()
  return words.slice(0, maxWords).join(' ').trim()
}

function buildStyleHook(styleKey: DraftStyle, companyName: string, industry: string, location: string) {
  switch (styleKey) {
    case 'provocative':
      return `Most ${industry} teams do not lose deals because demand is weak.\nThey lose time because the first outreach step is still too slow${location ? ` in ${location}` : ''}.`
    case 'curious':
      return `How is ${companyName} sourcing new conversations right now without turning prospecting into a weekly time sink?`
    case 'insight':
      return `Most ${industry} teams are not sitting on a lead problem.\nThey are sitting on a speed-to-contact problem.`
    case 'direct':
      return `${companyName} can get to qualified outreach much faster than most teams think.`
    case 'soft':
      return `Not sure if this is useful, but ${industry} teams often spend more time stitching lead lists together than starting real conversations.`
    default:
      return `${companyName} probably does not need more noise in the inbox.`
  }
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function fallbackDraft(params: GenerateParams): OutreachDraft {
  const companyName = params.company_name || 'your team'
  const style = pickRandom(STYLE_PROFILES, params.variation_seed)
  const cta = resolveCtaShape(params).text
  const location = params.location_input?.trim() || ''
  const industry = params.industry?.trim() || params.audience_input.trim() || 'service'
  const offerLine =
    params.offer_context?.what_you_do?.trim() ||
    params.offer.trim() ||
    'ALPA gives teams a faster way to find verified leads and start outreach'
  const outcomeLine =
    params.value_outcome?.trim() ||
    params.offer_context?.main_benefit?.trim() ||
    'That means less list-building and more real replies.'
  const hook = buildStyleHook(style.key, companyName, industry, location)
  const body = [
    hook,
    `${companyName} is probably not short on possible deals. The drag is how long it takes to surface the right prospects and start the first conversation. That usually means slower follow-up and more missed timing.`,
    `${offerLine}. ${outcomeLine} It keeps the first touch fast without sounding like a generic blast.`,
    cta,
  ].join('\n\n')
  const trimmedBody = trimToWordLimit(body, 120)
  const full_email = params.sender_signature ? `${trimmedBody}\n\n—\n${params.sender_signature}` : trimmedBody

  return {
    subject: normalizeSubject(`${companyName} pipeline gap`, companyName),
    hook,
    body: trimmedBody,
    cta,
    full_email,
    style: style.key,
    personalization_score: params.context.enriched ? 3 : 2,
    quality_score: 4,
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
        variation_seed: ((params.variation_seed ?? 0) + attempt) % STYLE_PROFILES.length,
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

    let body = sanitizeBody(cleanBody(result.body))
    const subject = normalizeSubject(String(result.subject || ''), params.company_name || 'ALPA')

    if (!body) {
      return fallbackDraft(params)
    }

    if (!body.includes(cta.text)) {
      body = `${body}\n\n${cta.text}`
    }

    body = trimToWordLimit(body, 120)

    if (countWords(body) < 80 || isGenericTemplate(body) || isEmailContaminated(body, params.audience_input)) {
      return fallbackDraft(params)
    }

    const hook = body.split('\n\n')[0]?.trim() ?? ''
    const style = pickRandom(STYLE_PROFILES, params.variation_seed).key

    const full_email = senderSignature ? `${body}\n\n—\n${senderSignature}` : body

    const wordCount = countWords(body)
    const hasRealContext =
      params.context.enriched && Boolean(params.context.h1 || params.context.description || params.industry)
    const personalization_score = hasRealContext ? 4 : 3
    const quality_score =
      wordCount >= 80 && wordCount <= 120 && !isGenericTemplate(body) ? 5 : 3

    return {
      subject,
      hook,
      body,
      cta: cta.text || 'Would you be open to a quick 10-minute chat?',
      full_email,
      style,
      personalization_score,
      quality_score,
    }
  } catch (error) {
    console.error('[generate-outreach-draft] failed, returning fallback', error)
    return fallbackDraft(params)
  }
}
