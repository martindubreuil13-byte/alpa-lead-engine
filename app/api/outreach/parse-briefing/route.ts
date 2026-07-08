import { Anthropic } from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface ParsedBriefing {
  offering: string
  audience: string
  goal: string
  confidence: number
}

export async function POST(request: Request) {
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

    const parsed: ParsedBriefing = JSON.parse(content.text)

    return Response.json(parsed)
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
