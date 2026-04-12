import { NextResponse } from 'next/server'
import { z } from 'zod'

import { openai } from '@/lib/ai/openai'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const searchableBusinessSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.split(/\s+/).length <= 3, {
    message: 'Business labels must be 1-3 words',
  })

const icpOutputSchema = z.object({
  target_businesses: z.array(searchableBusinessSchema).min(1),
  locations: z.array(z.string().trim().min(1)).min(1),
  pain_points: z.array(z.string().trim().min(1)).min(1).max(5),
  messaging_angles: z.array(z.string().trim().min(1)).max(3),
  summary: z
    .string()
    .trim()
    .min(1)
    .regex(/^Got it\.\sI(?:'|’)ll focus on/i),
})

export async function POST(req: Request) {
  try {
    const { input, location } = await req.json()

    if (!input) {
      return NextResponse.json({ error: 'Missing input' }, { status: 400 })
    }

    const resolvedLocation =
      typeof location === 'string' && location.trim().length > 0 ? location.trim() : 'Global'

    const prompt = `
You are an autonomous lead generation agent.

Your role is to interpret a business description and define a precise targeting strategy for lead generation and outreach.

You do not summarize.
You make decisions.

---

INPUT:
${input}

USER LOCATION:
${resolvedLocation}

---

OUTPUT FORMAT (STRICT JSON ONLY):

{
  "target_businesses": [],
  "locations": [],
  "pain_points": [],
  "messaging_angles": [],
  "summary": ""
}

---

RULES:

### AGENT MINDSET
- Act like you are preparing a targeting strategy
- Be decisive and confident
- Infer what the user means, not just what they say
- Prioritize clarity and usability over completeness

### TARGET BUSINESSES (CRITICAL)
- Use ONLY standard, searchable business types
- Each must be 1–3 words
- Include ALL relevant categories that logically fit the offer
- Do NOT artificially limit the number of items
- Avoid vague or generic terms

GOOD:
- "freelancer"
- "marketing agency"
- "consultant"
- "web developer"
- "copywriter"
- "SaaS startup"
- "accounting firm"

BAD:
- "small businesses needing help"
- "people who want leads"

### LOCATIONS
- Use the USER LOCATION provided
- If not specified, return "Global"
- Do NOT invent locations

### PAIN POINTS
- Do NOT repeat user input directly
- Infer deeper operational problems
- Include at least one non-obvious insight

GOOD:
- "lead flow is inconsistent and unpredictable"
- "growth depends entirely on manual effort"
- "no scalable client acquisition system"

### MESSAGING ANGLES
- Max 3
- Each must feel like a strong outreach hook
- Focus on transformation

GOOD:
- "turn inconsistent outreach into a predictable pipeline"
- "replace manual prospecting with an automated system"
- "free up time to focus on closing and delivery"

### SUMMARY (AGENT VOICE)
- ONE sentence only
- Must start with:

"Got it. I’ll focus on..."

- Must clearly state:
  - who will be targeted
  - why they are a strong fit
- Tone:
  calm, confident, operational

FINAL RULE:
Be sharp, practical, and decisive.
Return ONLY valid JSON.
`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You output ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })

    const text = completion.choices[0].message.content || ''

    let parsed: unknown

    try {
      parsed = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON from model', raw: text }, { status: 500 })
    }

    const validated = icpOutputSchema.safeParse(parsed)

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid JSON structure from model', raw: parsed },
        { status: 500 }
      )
    }

    const finalPayload = {
      ...validated.data,
      locations: [resolvedLocation],
    }

    const supabase = await createServerClient()
    const { data: user } = await supabase.auth.getUser()
    let savedRecordId: string | null = null
    let savedStatus = 'draft'
    let savedIsActive = false

    if (user?.user) {
      const { data: savedRecord } = await supabase
        .from('agent_icp')
        .insert({
          user_id: user.user.id,
          raw_input: input,
          structured_output: finalPayload,
          status: 'draft',
          is_active: false,
        })
        .select('id, status, is_active')
        .single()

      savedRecordId = savedRecord?.id ?? null
      savedStatus = savedRecord?.status ?? 'draft'
      savedIsActive = savedRecord?.is_active ?? false
    }

    return NextResponse.json({
      ...finalPayload,
      saved_record_id: savedRecordId,
      status: savedStatus,
      is_active: savedIsActive,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
