import { openai } from '@/lib/ai/openai'
import type { LeadContext } from '@/lib/agent/enrich-context'
import { buildPromptContext, formatCTA, sanitize } from '@/lib/agent/outreach-context'
import type { SelectedCta } from '@/lib/agent/user-ctas'

export type OutreachDraft = {
  subject: string
  hook: string
  body: string
  cta: string
  cta_label: string | null
  cta_type: string | null
  cta_value: string | null
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
  selected_cta?: SelectedCta | null
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
  variation_seed?: number
}

const STYLE_PROFILES = [
  {
    key: 'provocative',
    opener: 'Lead with a light challenge or friction point they are probably feeling already.',
  },
  {
    key: 'curious',
    opener: 'Open with a sharp question that sounds thoughtful, not salesy.',
  },
  {
    key: 'insight',
    opener: 'Lead with a simple observation about the way firms in this market usually lose time.',
  },
  {
    key: 'direct',
    opener: 'Be blunt and efficient. No story. No warmup.',
  },
  {
    key: 'soft',
    opener: 'Use a low-pressure tone that feels like a genuine note from one operator to another.',
  },
] as const satisfies Array<{ key: DraftStyle; opener: string }>

const BANNED_BODY_PATTERNS = [
  /i came across/gi,
  /i noticed your company/gi,
  /your website caught my attention/gi,
  /i hope this finds you well/gi,
  /\bwe provide\b/gi,
  /\bour solution\b/gi,
  /\bleverage\b/gi,
  /\boptimi[sz]e\b/gi,
  /\bsynergy\b/gi,
  /\bjust a thought\b/gi,
  /\bnot sure if relevant\b/gi,
]

const BANNED_PHRASES = [
  'timing gap',
  'pipeline momentum',
  'good intent',
  'accelerate client acquisition',
  'helps we help',
  'move faster toward',
  'so alpa provides',
]

const BANNED_OPENING_PREFIXES = ['i noticed', 'looking at', 'it seems', 'many teams']

const DEFAULT_FALLBACK_SIGNATURE = 'Martin | Founder MINDRA Solutions'

function pickRandom<T>(items: readonly T[], seed?: number): T {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return items[Math.abs(seed) % items.length]!
  }
  return items[Math.floor(Math.random() * items.length)]!
}

function extractUserName(signature: string | null | undefined): string | null {
  if (!signature) return null
  const cleaned = signature.replace(/^[-—\s]+/, '').trim()
  const firstLine = cleaned.split(/[\n,|]/)[0]?.trim() ?? ''
  const firstWord = firstLine.split(/\s+/)[0] ?? ''
  return firstWord.length >= 2 ? firstWord : null
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function trimToWordLimit(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return value.trim()
  return words.slice(0, maxWords).join(' ').trim()
}

function splitSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function splitParagraphs(value: string) {
  return value
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function cleanBody(body: string) {
  const strippedListMarkers = body
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')

  const paragraphs = strippedListMarkers.split(/\n\n+/)
  const seen = new Set<string>()
  const deduped = paragraphs.filter((paragraph) => {
    const key = paragraph.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })

  return deduped.join('\n\n').trim()
}

function sanitizeBody(body: string) {
  let next = cleanBody(body)
  for (const pattern of BANNED_BODY_PATTERNS) {
    next = next.replace(pattern, '')
  }
  return sanitize(next)
}

function normalizeSubject(subject: string, companyName: string) {
  const cleaned = sanitize(String(subject || '').replace(/\s+/g, ' ').trim())
  const limited = cleaned.split(' ').filter(Boolean).slice(0, 6).join(' ')
  return limited || `${companyName} lead gap`
}

function buildSoftClose(style: DraftStyle) {
  switch (style) {
    case 'provocative':
      return 'Worth testing?'
    case 'curious':
      return 'Worth testing?'
    case 'insight':
      return 'Worth testing?'
    case 'direct':
      return 'Worth testing?'
    case 'soft':
      return 'Or maybe you’ve already solved this.'
    default:
      return 'Worth testing?'
  }
}

function hasBannedPhrase(body: string) {
  const lower = body.toLowerCase()
  return BANNED_PHRASES.some((phrase) => lower.includes(phrase))
}

function hasWeakOpening(body: string) {
  const firstParagraph = splitParagraphs(body)[0]?.toLowerCase().trim() ?? ''
  return BANNED_OPENING_PREFIXES.some((prefix) => firstParagraph.startsWith(prefix))
}

function extractLeadAnchor(companyName: string, industry: string, location: string) {
  const companyTokens = companyName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
  const industryTokens = industry
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
  const locationTokens = location
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)

  return [...companyTokens, ...industryTokens.slice(0, 2), ...locationTokens.slice(0, 1)]
}

function hasSpecificAnchor(body: string, companyName: string, industry: string, location: string) {
  const lower = body.toLowerCase()
  return extractLeadAnchor(companyName, industry, location).some((token) => lower.includes(token))
}

function getTensionScore(body: string) {
  const lower = body.toLowerCase()
  const frictionTokens = [
    'timing',
    'lag',
    'slow',
    'stalls',
    'pipeline',
    'outreach',
    'response window',
    'conversion',
    'follow-up',
    'list prep',
    'research drag',
    'handoff',
    'contact-ready',
    'lead list',
    'missed',
    'late',
    'stale',
    'window',
    'delay',
  ]
  const impactTokens = [
    'lost',
    'missed',
    'delayed',
    'too late',
    'cold',
    'dies',
    'stalls',
    'slips',
  ]

  const hasFriction = frictionTokens.some((token) => lower.includes(token))
  const hasImpact = impactTokens.some((token) => lower.includes(token))

  if (hasFriction && hasImpact) return 2
  if (hasFriction) return 1
  return 0
}

function hasIndustryReference(body: string, industry: string) {
  const lower = body.toLowerCase()
  const tokens = industry
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)

  return tokens.some((token) => lower.includes(token))
}

function buildActionDrivenCta(cta: SelectedCta | null | undefined) {
  return formatCTA(cta ?? null)
}

function isUnreadableBody(body: string) {
  const trimmed = body.trim()
  if (!trimmed) return true
  if (!/[a-z]/i.test(trimmed)) return true
  if (trimmed.length < 40) return true
  const lines = trimmed.split('\n').filter(Boolean)
  return lines.some((line) => line.length > 220)
}

function hasSolutionSignal(body: string, whatYouDo: string, mainBenefit: string, angle: string) {
  const lower = body.toLowerCase()
  const tokens = [whatYouDo, mainBenefit, angle]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 4)

  const cueWords = [
    'helps',
    'so',
    'through',
    'with',
    'faster',
    'ready-to-contact',
    'conversations start',
    'timing still matters',
  ]

  return tokens.some((token) => lower.includes(token)) || cueWords.some((token) => lower.includes(token))
}

function hasStackedSolution(body: string) {
  const lower = body.toLowerCase()
  const lines = lower
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const solutionLines = lines.filter(
    (line) =>
      line.includes(' helps ') ||
      line.includes(' so ') ||
      line.includes(' with ') ||
      line.includes(' through ') ||
      line.includes(' lets ') ||
      line.includes(' means ')
  )

  if (solutionLines.length > 1) return true

  const connectorCount = (lower.match(/\b(and|while|plus|without|instead of)\b/g) ?? []).length
  return connectorCount >= 4
}

function getSolutionSentences(body: string) {
  return splitSentences(body).filter((sentence) => {
    const lower = sentence.toLowerCase()
    return (
      lower.includes(' helps ') ||
      lower.includes(' so ') ||
      lower.includes(' with ') ||
      lower.includes(' through ') ||
      lower.includes(' lets ') ||
      lower.includes(' means ')
    )
  })
}

function hasCleanSolutionSentence(body: string) {
  const solutionSentences = getSolutionSentences(body)
  if (solutionSentences.length !== 1) return false

  const solution = solutionSentences[0]!.toLowerCase()
  const commaCount = (solution.match(/,/g) ?? []).length
  if (commaCount > 1) return false

  const repeatedKeywords = ['lead', 'leads', 'data', 'enriched', 'contact', 'contacts']
  if (repeatedKeywords.some((keyword) => (solution.match(new RegExp(`\\b${keyword}\\b`, 'g')) ?? []).length > 1)) {
    return false
  }

  const connectorHits = (solution.match(/\b(so|helps|with|through|and)\b/g) ?? []).length
  return connectorHits <= 2
}

function hasOverCommaSentence(body: string) {
  return splitSentences(body).some((sentence) => ((sentence.match(/,/g) ?? []).length > 2))
}

function hasLongSentence(body: string) {
  return splitSentences(body).some((sentence) => countWords(sentence) > 18)
}

function hasRepeatedConcepts(body: string) {
  const lower = body.toLowerCase()
  const repeatedKeywords = ['lead', 'leads', 'contact', 'contacts', 'data', 'enriched', 'outreach']
  return repeatedKeywords.some((keyword) => (lower.match(new RegExp(`\\b${keyword}\\b`, 'g')) ?? []).length > 2)
}

function hasBrokenPhrasing(body: string) {
  const lower = body.toLowerCase()
  return (
    lower.includes('helps we help') ||
    lower.includes('move faster toward') ||
    lower.includes('so alpa provides') ||
    lower.includes('..') ||
    lower.includes(',,')
  )
}

function feelsGeneric(body: string) {
  const lower = body.toLowerCase()
  return (
    lower.includes('i wanted to reach out') ||
    lower.includes('touching base') ||
    lower.includes('we provide') ||
    lower.includes('our solution') ||
    lower.includes('leverage') ||
    lower.includes('save time and money') ||
    lower.includes('grow your business') ||
    lower.includes('streamline your workflow')
  )
}

function scoreCandidate(
  body: string,
  companyName: string,
  industry: string,
  location: string,
  whatYouDo: string,
  mainBenefit: string,
  angle: string,
  ctaExpected: boolean,
  ctaLine: string | null
) {
  let score = 0
  const hasCompany = hasSpecificAnchor(body, companyName, '', location)
  const hasIndustry = hasIndustryReference(body, industry)
  const tensionScore = getTensionScore(body)
  const hasSolution = hasSolutionSignal(body, whatYouDo, mainBenefit, angle)
  const hasExpectedCta = !ctaExpected || Boolean(ctaLine && body.includes(ctaLine))
  const stackedSolution = hasStackedSolution(body)
  const generic = feelsGeneric(body)
  const cleanSolution = hasCleanSolutionSentence(body)

  if (hasCompany) score += 1
  if (hasIndustry) score += 1
  score += tensionScore
  if (hasSolution && cleanSolution) score += 1
  if (hasExpectedCta) score += 1

  return {
    score,
    hasCompany,
    hasIndustry,
    tensionScore,
    hasSolution,
    cleanSolution,
    hasExpectedCta,
    stackedSolution,
    generic,
  }
}

function stripExistingCta(body: string, cta: SelectedCta | null | undefined) {
  if (!cta) return body.trim()

  const ctaValue = cta.value?.trim()
  const ctaLabel = cta.label?.trim()

  const keptLines = body
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (ctaValue && trimmed.includes(ctaValue)) return false
      if (cta.type === 'text' && ctaLabel && trimmed === ctaLabel) return false
      if (/^(test it here|book a time|reply here):/i.test(trimmed)) return false
      return true
    })

  return keptLines.join('\n').trim()
}

function hasReadableStructure(body: string, ctaExpected: boolean) {
  const paragraphs = splitParagraphs(body)
  if (paragraphs.length !== (ctaExpected ? 4 : 3)) return false

  const hookSentences = splitSentences(paragraphs[0] ?? '')
  const painSentences = splitSentences(paragraphs[1] ?? '')
  const solutionSentences = splitSentences(paragraphs[2] ?? '')

  if (hookSentences.length !== 1) return false
  if (painSentences.length < 1 || painSentences.length > 2) return false
  if (solutionSentences.length !== 1) return false

  if (ctaExpected) {
    const ctaSentences = splitSentences(paragraphs[3] ?? '')
    if (ctaSentences.length !== 1) return false
  }

  if (paragraphs.some((paragraph) => splitSentences(paragraph).length > 2)) return false
  if (hasLongSentence(body)) return false

  return true
}

function buildPrompt(params: GenerateParams) {
  const userName = params.user_name ?? extractUserName(params.sender_signature) ?? 'the sender'
  const userCompany = params.user_company ?? null
  const industryStr = params.industry?.trim() || params.audience_input.trim() || 'their market'
  const locationStr = params.location_input?.trim() || 'their market'
  const ctaText = buildActionDrivenCta(params.selected_cta ?? null)
  const context = {
    companyName: params.company_name,
    icp: industryStr,
    location: locationStr,
    whatYouDo: params.offer_context?.what_you_do || params.offer || 'Not specified',
    whoYouHelp: params.offer_context?.who_you_help || params.audience_input || 'Not specified',
    mainBenefit:
      params.offer_context?.main_benefit ||
      params.value_outcome ||
      'less time spent preparing lists before outreach',
    angle:
      params.offer_context?.angle ||
      params.pain_solved ||
      'Most teams lose time getting a usable lead list together.',
    cta: ctaText,
    ctaInstruction:
      params.selected_cta?.type === 'link'
        ? `Use this exact final CTA line if you include a CTA: "Test it here: ${params.selected_cta.value}".`
        : params.selected_cta?.type === 'calendly'
          ? `Use this exact final CTA line if you include a CTA: "Book a time: ${params.selected_cta.value}".`
          : params.selected_cta?.type === 'email'
            ? `Use this exact final CTA line if you include a CTA: "Reply here: ${params.selected_cta.value}".`
            : params.selected_cta?.type === 'text'
              ? `Use this exact final CTA line if you include a CTA: "${params.selected_cta.label}".`
            : 'If no CTA is provided, end with a short close like "Worth testing?" or "Or maybe you’ve already solved this."',
  }

  return `${buildPromptContext(
    {
      name: userName,
      company: userCompany ?? undefined,
      website: params.context.website || undefined,
      offer: context.whatYouDo || undefined,
    },
    {
      companyName: context.companyName,
      industry: context.icp,
      location: context.location,
      description: undefined,
    },
    params.selected_cta ?? null
  )}
Context:
- Company name: ${context.companyName}
- Industry / ICP: ${context.icp}
- Location: ${context.location}
- What we do: ${context.whatYouDo}
- Who we help: ${context.whoYouHelp}
- Main benefit: ${context.mainBenefit}
- Angle: ${context.angle}
- CTA: ${context.cta ?? 'none'}

You are writing a short outbound email from one operator to another.

You are part of an automated outbound system. You must generate the final email using provided data. You are not allowed to ask for inputs or clarification.

You must:
- Write under 80 words
- Never use placeholders
- Never ask questions to the user
- Never output {{variables}}
- Never ask a question in the opening line
- Never open with "Noticed", "Curious", or "I see"
- Never open with "I noticed", "Looking at", "It seems", or "Many teams"
- Use simple international English
- Keep every sentence under 18 words

Structure:
1. Paragraph 1: one sentence hook using a direct truth, strong pattern, or slightly provocative statement
2. Paragraph 2: one or two short pain sentences
3. Paragraph 3: exactly one solution sentence
4. Paragraph 4: one short CTA line only if CTA exists

Formatting:
- Use blank lines between paragraphs
- Do not write one dense block
- Do not use bullets

Tone:
- Observational
- Calm confidence
- Slightly provocative
- Not salesy
- Not generic
- Short, punchy sentences

Forbidden phrases:
- Noticed
- Curious
- I see
- we provide
- our solution
- leverage
- cutting-edge
- optimize
- synergy
- just a thought
- not sure if relevant

Anti-generic rule:
- If this could be sent to any company, it is wrong
- Mention ${context.companyName} or their market naturally
- Include a concrete friction, not a vague complaint
- Use the mission context to explain the shift in outcome, not features
- Make the reader feel the cost of delay or bad timing
- Start with a direct truth or strong pattern, not a soft observation

Solution collapse rule:
- Write only one solution sentence
- Express one idea only
- Focus on outcome, not features
- Do not chain multiple phrases with commas
- Do not repeat leads, enriched, data, or contacts
- Do not stack "so", "helps", and "with" in the same thought
- Do not use abstract phrases like "timing gap" or "pipeline momentum"

CTA rule:
- Include exactly one CTA if CTA is provided
- Make it action-driven and test-oriented
- ${context.ctaInstruction}

If context is weak, stay simple and do not invent specifics.
Do not include a signature.

Return ONLY:
Subject: <2–4 lowercase words>
Body:
<four short paragraphs max>

Return ONLY valid JSON:
{
  "subject": "<under 6 words>",
  "body": "<plain email body>"
}`
}

function fallbackDraft(params: GenerateParams, style: DraftStyle): OutreachDraft {
  const ctaLine = buildActionDrivenCta(params.selected_cta ?? null)
  const body = ctaLine
    ? [
        'Speed is where most teams lose deals.',
        'They search, check contacts, and prepare lists while opportunities go cold.',
        'ALPA helps you get ready-to-contact leads in seconds, so you can start conversations faster.',
        ctaLine,
      ].join('\n\n')
    : [
        'Speed is where most teams lose deals.',
        'They search, check contacts, and prepare lists while opportunities go cold.',
        'ALPA helps you get ready-to-contact leads in seconds, so you can start conversations faster.',
      ].join('\n\n')
  const fullEmail = `${body}\n\n—\n${params.sender_signature || DEFAULT_FALLBACK_SIGNATURE}`

  return {
    subject: 'faster outreach',
    hook: body.split('\n\n')[0] || '',
    body,
    cta: ctaLine || '',
    cta_label: params.selected_cta?.label ?? null,
    cta_type: params.selected_cta?.type ?? null,
    cta_value: params.selected_cta?.value ?? null,
    full_email: fullEmail,
    style,
    personalization_score: params.context.enriched ? 3 : 2,
    quality_score: 4,
  }
}

async function callOpenAI(prompt: string): Promise<{ subject: string; body: string } | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are part of an automated outbound system. You must generate the final email using provided data. You are not allowed to ask for inputs or clarification. You output only valid JSON with subject and body.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.78,
      max_tokens: 420,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0]?.message.content?.trim() || ''
    const parsed = JSON.parse(text) as Record<string, unknown>
    const subject = String(parsed.subject || '').trim()
    const body = String(parsed.body || '').trim()
    if (!subject || !body) return null
    return { subject, body }
  } catch {
    return null
  }
}

function logFinalDraft(draft: OutreachDraft, selectedCta: SelectedCta | null | undefined) {
  console.log('[CTA DEBUG]', {
    selected_cta: selectedCta ?? null,
    finalCTA: formatCTA(selectedCta ?? null),
  })
  console.log('[OUTREACH FINAL]', {
    subject: draft.subject,
    body: draft.body,
    cta: selectedCta ?? null,
  })
}

export async function generateOutreachDraft(params: GenerateParams): Promise<OutreachDraft> {
  const style = pickRandom(STYLE_PROFILES, params.variation_seed).key
  const ctaLine = buildActionDrivenCta(params.selected_cta ?? null)
  const senderSignature = params.sender_signature ?? null
  const industryStr = params.industry?.trim() || params.audience_input.trim() || 'their market'
  const locationStr = params.location_input?.trim() || 'their market'
  const whatYouDo = params.offer_context?.what_you_do || params.offer || ''
  const mainBenefit =
    params.offer_context?.main_benefit || params.value_outcome || 'faster outreach timing'
  const angle =
    params.offer_context?.angle || params.pain_solved || 'less delay between search and first contact'

  try {
    let result: { subject: string; body: string } | null = null

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const candidate = await callOpenAI(
        buildPrompt({
          ...params,
          variation_seed: (params.variation_seed ?? 0) + attempt,
        })
      )

      if (!candidate?.subject || !candidate.body) {
        console.log('[GEN RESULT]', { accepted: false, score: 0 })
        continue
      }

      if (candidate.subject.includes('{{') || candidate.body.includes('{{')) {
        console.log('[GEN RESULT]', { accepted: false, score: 0 })
        continue
      }

      const candidateBody = trimToWordLimit(sanitizeBody(candidate.body), ctaLine ? 68 : 74)
      if (
        isUnreadableBody(candidateBody) ||
        hasOverCommaSentence(candidateBody) ||
        hasBannedPhrase(candidateBody) ||
        hasWeakOpening(candidateBody) ||
        hasBrokenPhrasing(candidateBody) ||
        hasRepeatedConcepts(candidateBody)
      ) {
        console.log('[GEN RESULT]', { accepted: false, score: 0 })
        continue
      }

      const scoring = scoreCandidate(
        candidateBody,
        params.company_name || '',
        industryStr,
        locationStr,
        whatYouDo,
        mainBenefit,
        angle,
        Boolean(ctaLine),
        ctaLine
      )

      const hasReference = scoring.hasCompany || scoring.hasIndustry
      const accepted =
        hasReference &&
        scoring.score >= 4 &&
        scoring.tensionScore === 2 &&
        scoring.cleanSolution &&
        !scoring.stackedSolution &&
        !scoring.generic &&
        hasReadableStructure(candidateBody, Boolean(ctaLine))
      console.log('[GEN RESULT]', { accepted, score: scoring.score })

      if (!accepted) {
        continue
      }

      result = {
        subject: candidate.subject,
        body: candidateBody,
      }
      break
    }

    if (!result) {
      const fallback = fallbackDraft(params, style)
      console.log('[FALLBACK USED]', 'score_below_threshold')
      logFinalDraft(fallback, params.selected_cta)
      return fallback
    }

    let body = result.body

    if (ctaLine) {
      body = stripExistingCta(body, params.selected_cta)
      body = `${body.trim()}\n\n${ctaLine}`
    } else {
      const softClose = buildSoftClose(style)
      const normalizedBody = body.trim().toLowerCase()
      const normalizedClose = softClose.trim().toLowerCase()
      if (!normalizedBody.endsWith(normalizedClose)) {
        body = `${body.trim()}\n\n${softClose}`
      }
    }

    body = trimToWordLimit(body, 80)

    const subject = normalizeSubject(result.subject, params.company_name || 'your team')
    const hook = body.split('\n\n')[0]?.trim() ?? ''
    const fullEmail = senderSignature ? `${body}\n\n—\n${senderSignature}` : body
    const wordCount = countWords(body)
    const personalizationScore =
      params.context.enriched && Boolean(params.context.h1 || params.context.description || params.industry)
        ? 4
        : 3
    const qualityScore = wordCount <= 80 ? 5 : 3

    const draft = {
      subject,
      hook,
      body,
      cta: ctaLine || '',
      cta_label: params.selected_cta?.label ?? null,
      cta_type: params.selected_cta?.type ?? null,
      cta_value: params.selected_cta?.value ?? null,
      full_email: fullEmail,
      style,
      personalization_score: personalizationScore,
      quality_score: qualityScore,
    }
    logFinalDraft(draft, params.selected_cta)
    return draft
  } catch (error) {
    console.error('[generate-outreach-draft] failed, returning fallback', error)
    const fallback = fallbackDraft(params, style)
    console.log('[FALLBACK USED]', 'generation_error')
    logFinalDraft(fallback, params.selected_cta)
    return fallback
  }
}
