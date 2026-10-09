import { Anthropic } from '@anthropic-ai/sdk'
import { adminGuard } from '@/lib/auth/require-admin'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface ParsedBriefing {
  offering: string
  audience: string
  goal: string
  confidence: number
}

function cleanExtractedField(value: unknown) {
  if (typeof value !== 'string') return ''

  const cleaned = value.trim().replace(/\s+/g, ' ')
  const invalidValues = new Set([
    '',
    'n/a',
    'na',
    'none',
    'not specified',
    'unspecified',
    'unknown',
    'unclear',
    'not clear',
    'not mentioned',
  ])

  if (invalidValues.has(cleaned.toLowerCase())) return ''
  if (cleaned.length < 3) return ''

  return cleaned
}

export async function POST(request: Request) {
  const denied = await adminGuard()
  if (denied) return denied

  try {
    const { input } = await request.json()

    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return Response.json(
        { error: 'Invalid input' },
        { status: 400 }
      )
    }

    // Use Claude Haiku to extract commercial intent
    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Extract the commercial intent from this user input. Return ONLY valid JSON with no markdown or explanation.

Input: "${input}"

Return JSON with exactly these fields:
{
  "offering": "what they're offering/promoting",
  "audience": "who they're trying to reach",
  "goal": "what they want to achieve",
  "confidence": 0.8
}

Be concise. Extract only from what they said. If something is unclear, leave it as empty string.`,
        },
      ],
    })

    // Parse the response
    const content = message.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type')
    }

    const parsed = JSON.parse(content.text) as Partial<ParsedBriefing>
    const sanitized: ParsedBriefing = {
      offering: cleanExtractedField(parsed.offering),
      audience: cleanExtractedField(parsed.audience),
      goal: cleanExtractedField(parsed.goal),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    }

    return Response.json(sanitized)
  } catch (error) {
    console.error('[parse-briefing] Error:', error)

    // Return a safe fallback on any error
    return Response.json(
      {
        offering: '',
        audience: '',
        goal: '',
        confidence: 0,
      } as ParsedBriefing,
      { status: 200 }
    )
  }
}
