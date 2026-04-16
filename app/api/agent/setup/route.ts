import { NextResponse } from 'next/server'
import { z } from 'zod'

import { openai } from '@/lib/ai/openai'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const requestSchema = z.object({
  offer: z.string().trim().min(3).max(1000),
  audience: z.string().trim().min(2).max(1000),
  location: z.string().trim().min(1).max(300),
})

const prompt = (offer: string, audience: string, location: string) => `
You are an expert B2B go-to-market strategist.

User input:
- Offer: ${offer}
- Audience: ${audience}
- Location: ${location}

Task:
1. Rewrite their offer into a clear, grounded business statement
2. Expand their audience into 10–15 specific, searchable ICP segments (1–3 words each, like "marketing agency", "SaaS startup", "real estate broker")
3. Generate 8–12 search query patterns combining ICP segments + location that work as Google/directory search strings

Return ONLY valid JSON in this exact shape:
{
  "offer_context": {
    "what_you_do": "one sentence describing the product/service",
    "who_you_help": "one sentence describing the ideal client",
    "main_benefit": "the single most compelling outcome for the client",
    "angle": "the sharpest outreach hook — what makes this irresistible"
  },
  "icp_expanded": [
    "segment 1",
    "segment 2"
  ],
  "search_patterns": [
    "marketing agency Toronto",
    "SaaS startup Vancouver"
  ]
}

Rules:
- icp_expanded: 10–15 items, 1–3 words each, standard searchable business types
- search_patterns: 8–12 items, combine top ICP segments with location
- Be specific, decisive, and practical
- No vague terms like "businesses that need help"
- Return ONLY the JSON object
`

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    const { error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { offer, audience, location } = parsed.data

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You output ONLY valid JSON. No markdown. No explanation.' },
        { role: 'user', content: prompt(offer, audience, location) },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0].message.content?.trim() || ''
    let result: unknown

    try {
      result = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'LLM_PARSE_FAILED', raw: text }, { status: 500 })
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('[agent/setup] error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
