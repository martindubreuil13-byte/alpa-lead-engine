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
  location: string | null
  offer: string
  angles: string[]
  context: LeadContext
  offer_context?: OfferContext | null
}

function buildPrompt(params: GenerateParams): string {
  const { company_name, location, offer, angles, context, offer_context } = params

  const contextBlock = context.enriched
    ? `Website context:
- Headline: "${context.h1 || context.title}"
- Description: "${context.description}"`
    : `No website data available. Infer from the company name and location.`

  const offerBlock = offer_context
    ? `What we do: ${offer_context.what_you_do}
Who we help: ${offer_context.who_you_help}
Main benefit: ${offer_context.main_benefit}
Outreach angle: ${offer_context.angle}`
    : offer

  const angleList =
    angles.length > 0
      ? angles.slice(0, 2).map((a) => `- ${a}`).join('\n')
      : '- Help them grow their client pipeline'

  return `You write short, sharp cold outreach emails. Output ONLY valid JSON.

TARGET:
- Company: ${company_name}
- Location: ${location || 'Unknown'}

${contextBlock}

OFFER:
${offerBlock}

MESSAGING ANGLES:
${angleList}

RULES:
- Under 120 words total
- No "hope you're well" or filler
- No vague promises
- One clear benefit
- One soft CTA
- Human, direct tone

OUTPUT FORMAT (strict JSON):
{
  "subject": "short subject line, max 60 chars",
  "hook": "opening sentence referencing their business",
  "body": "1-2 sentences presenting the benefit",
  "cta": "one soft call to action",
  "full_email": "hook + body + cta as a single flowing email",
  "personalization_score": <0-5 integer>,
  "quality_score": <0-5 integer>
}

Scoring guide:
- personalization_score: +2 company name used, +2 website context used, +1 location used
- quality_score: +2 under 120 words, +2 clear CTA, +1 no filler phrases`
}

function fallbackDraft(company_name: string): OutreachDraft {
  const hook = `I came across ${company_name} and wanted to reach out.`
  const body = `We help businesses like yours generate qualified leads automatically — without the manual prospecting.`
  const cta = `Would it make sense to connect for 15 minutes?`
  return {
    subject: `Quick question for ${company_name}`,
    hook,
    body,
    cta,
    full_email: `${hook} ${body} ${cta}`,
    personalization_score: 1,
    quality_score: 2,
  }
}

export async function generateOutreachDraft(params: GenerateParams): Promise<OutreachDraft> {
  const prompt = buildPrompt(params)

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You output ONLY valid JSON. No markdown. No explanation.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.65,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0].message.content?.trim() || ''
    const parsed = JSON.parse(text) as Partial<OutreachDraft>

    return {
      subject: String(parsed.subject || `Quick question for ${params.company_name}`).slice(0, 120),
      hook: String(parsed.hook || '').slice(0, 400),
      body: String(parsed.body || '').slice(0, 600),
      cta: String(parsed.cta || '').slice(0, 200),
      full_email: String(parsed.full_email || '').slice(0, 1200),
      personalization_score: Number(parsed.personalization_score ?? 0),
      quality_score: Number(parsed.quality_score ?? 0),
    }
  } catch {
    console.log('[generate-outreach-draft] generation failed, using fallback for', params.company_name)
    return fallbackDraft(params.company_name)
  }
}
