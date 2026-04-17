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
  // Richer sender identity — optional, derived from mission/signature when absent
  user_name?: string | null
  user_role?: string | null
  user_company?: string | null
  // Offer framing — optional, derived from offer_context when absent
  pain_solved?: string | null
  value_outcome?: string | null
  // CTA shape — auto-detected from mission_cta when absent
  cta_type?: 'conversation' | 'link' | 'offer' | null
  cta_link?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pull a first name out of a free-form signature string. */
function extractUserName(signature: string | null | undefined): string | null {
  if (!signature) return null
  // "— Martin", "- Martin Dubreuil", "Best,\nMartin", "Martin | ALPA", "Martin"
  const cleaned = signature.replace(/^[-—\s]+/, '').trim()
  const firstLine = cleaned.split(/[\n,|]/)[0]?.trim() ?? ''
  const firstWord = firstLine.split(/\s+/)[0] ?? ''
  return firstWord.length >= 2 ? firstWord : null
}

/** Detect CTA shape and extract a bare link if present. */
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
    (urlMatch || cta_link ? 'link' : /\?|worth|happy|open|curious|quick/i.test(ctaText) ? 'conversation' : 'offer')

  const link = cta_link ?? urlMatch?.[0] ?? null

  return { type, text: ctaText, link }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(params: GenerateParams): string {
  const { company_name, audience_input, location_input, offer, offer_context, context } = params

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
  const userCompany = params.user_company ?? offer_context?.what_you_do?.split(' ').slice(0, 3).join(' ') ?? null
  const userLines = [
    `Name: ${userName}`,
    userRole && `Role: ${userRole}`,
    userCompany && `Company: ${userCompany}`,
  ].filter(Boolean).join('\n')

  // ── Offer framing
  const offerStr = offer_context ? offer_context.what_you_do : offer
  const painStr = params.pain_solved ?? offer_context?.angle ?? 'manual, time-consuming lead generation'
  const outcomeStr = params.value_outcome ?? offer_context?.main_benefit ?? 'generates consistent results'
  const audienceStr = [audience_input, location_input].filter(Boolean).join(' in ')

  // ── CTA instruction
  const cta = resolveCtaShape(params)
  let ctaInstruction: string
  if (cta.type === 'none') {
    ctaInstruction = 'No CTA. End after the solution paragraph.'
  } else if (cta.type === 'conversation') {
    ctaInstruction = `CTA type: conversation\nUse this exact text: "${cta.text}"`
  } else if (cta.type === 'link') {
    const linkDisplay = cta.link ?? ''
    ctaInstruction = `CTA type: link\nText: "${cta.text.replace(linkDisplay, '').trim() || cta.text}"\nLink: ${linkDisplay}\nFormat the CTA as the text followed by the link on the same line.`
  } else {
    ctaInstruction = `CTA type: offer\nSoft close — no link. Use something like: "Happy to show you how it works." or "Worth a quick look?"`
  }

  return `You are generating a highly personalized cold email.

---------------------------------------
INPUT — LEAD
---------------------------------------
Company: ${company_name}
Website: ${websiteStr}
Context:
${contextStr}

---------------------------------------
INPUT — USER
---------------------------------------
${userLines}

Offer: ${offerStr}
Target audience: ${audienceStr}
Pain solved: ${painStr}
Outcome: ${outcomeStr}

---------------------------------------
CTA HANDLING
---------------------------------------
${ctaInstruction}

---------------------------------------
RULES
---------------------------------------
- 80–120 words max (body only, subject excluded)
- Natural, human tone — no corporate or sales language
- No generic phrases ("your website caught my attention", "I came across", "I noticed your company")
- No fake personalization — only use details present in the context above
- If context is weak: keep the message simple and clean, do not invent details
- Vary sentence structure

---------------------------------------
LOGIC
---------------------------------------
Follow this reasoning:
  "Because [company] does [X from context] → they likely face [pain] → I help with [offer]"
If context is empty: skip the relevance line and go straight to problem → solution.

---------------------------------------
STRUCTURE (MANDATORY)
---------------------------------------
1. Opening → short, natural question (1 sentence)
2. Relevance → show understanding of what they do (1 sentence max — skip if no context)
3. Problem → real-world pain this business faces
4. Solution → one sentence describing the offer
5. CTA → as specified above (ONCE, at the end, exactly as written)

---------------------------------------
OUTPUT FORMAT
---------------------------------------
Return ONLY valid JSON — no markdown, no preamble:
{
  "subject": "<3–6 words, natural, curiosity-driven, no clickbait, no ALL CAPS>",
  "body": "<complete email body — paragraphs separated by \\n\\n — CTA on its own line at the end>"
}`
}

// ─── Post-process ─────────────────────────────────────────────────────────────

/** Deduplicate identical paragraphs. Does NOT strip the CTA — it belongs in the body. */
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
  const name = params.company_name || 'your business'
  const audience = params.audience_input || 'clients'
  const cta = resolveCtaShape(params)
  const userName = params.user_name ?? extractUserName(params.sender_signature) ?? null

  const hook = `Quick question — how is ${name} currently finding new ${audience}?`
  const paragraphs = [
    hook,
    `Most teams still rely on referrals or manual search, which makes the pipeline slow and unpredictable.`,
    `We built a tool that finds leads in seconds — complete with website, email, and phone.`,
  ]
  if (cta.type !== 'none' && cta.text) {
    paragraphs.push(cta.type === 'link' && cta.link ? `${cta.text} ${cta.link}` : cta.text)
  }

  const body = paragraphs.join('\n\n')
  const full_email = params.sender_signature
    ? `${body}\n\n—\n${params.sender_signature}`
    : body

  const ctaWord = name.split(' ')[0] ?? name

  return {
    subject: `Finding New ${ctaWord} Clients`,
    hook,
    body,
    cta: cta.text,
    full_email,
    personalization_score: 1,
    quality_score: 2,
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateOutreachDraft(params: GenerateParams): Promise<OutreachDraft> {
  const missionCta = params.mission_cta ?? null
  const senderSignature = params.sender_signature ?? null
  const prompt = buildPrompt(params)
  const cta = resolveCtaShape(params)

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
      max_tokens: 450,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0].message.content?.trim() || ''
    const parsed = JSON.parse(text) as Record<string, unknown>

    const subject = String(parsed.subject || '').trim().slice(0, 80)
    const rawBody = String(parsed.body || '').trim().slice(0, 800)

    if (!subject || !rawBody) {
      console.log('[generate-outreach-draft] missing subject/body → fallback', { company: params.company_name })
      return fallbackDraft(params)
    }

    // If mission has a CTA, verify it appears in the body
    if (missionCta && !rawBody.includes(missionCta.trim())) {
      console.log('[generate-outreach-draft] CTA missing from body → fallback', {
        company: params.company_name,
        expectedCta: missionCta,
      })
      return fallbackDraft(params)
    }

    const body = cleanBody(rawBody)
    const hook = body.split('\n\n')[0]?.trim() ?? ''

    // full_email = body (CTA already embedded by AI) + signature
    const full_email = senderSignature ? `${body}\n\n—\n${senderSignature}` : body

    // Score locally — no AI scoring needed
    const wordCount = body.split(/\s+/).length
    const hasRealContext = params.context.enriched && Boolean(params.context.h1 || params.context.description)
    const personalization_score = hasRealContext ? 4 : 2
    const quality_score = wordCount <= 120 ? (wordCount >= 60 ? 4 : 3) : 2

    return {
      subject,
      hook,
      body,
      cta: cta.text,
      full_email,
      personalization_score,
      quality_score,
    }
  } catch (err) {
    console.log('[generate-outreach-draft] error → fallback', { company: params.company_name, err })
    return fallbackDraft(params)
  }
}
