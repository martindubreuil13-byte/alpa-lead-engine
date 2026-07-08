import { Anthropic } from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface CommercialRecommendationRequest {
  offering: string
  audience: string
  goal: string
}

interface CommercialRecommendation {
  advice: string
  priorityField: string | null
  priorityValue: string | null
  confidence: number
}

export async function POST(request: Request) {
  try {
    const { offering, audience, goal } =
      (await request.json()) as CommercialRecommendationRequest

    if (!offering || !audience) {
      return Response.json(
        { error: 'Invalid input' },
        { status: 400 }
      )
    }

    // Use Claude Haiku for lightweight reasoning
    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `You are a commercial advisor. Given this business offering and target audience, produce one practical recommendation that could improve outreach quality.

Offering: ${offering}
Target Audience: ${audience}
Goal: ${goal}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "advice": "One or two sentences of specific, practical advice",
  "priorityField": null or "field_name",
  "priorityValue": null or "value",
  "confidence": 0.7
}

The advice should be specific and actionable, never use clichés. Maximum two sentences.`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type')
    }

    const parsed: CommercialRecommendation = JSON.parse(content.text)

    return Response.json(parsed)
  } catch (err) {
    console.error('[commercial-recommendation] Error:', err)

    // Return a safe fallback on any error
    return Response.json(
      {
        advice: '',
        priorityField: null,
        priorityValue: null,
        confidence: 0,
      } as CommercialRecommendation,
      { status: 200 }
    )
  }
}
