import { NextResponse } from 'next/server'
import { z } from 'zod'

import { openai } from '@/lib/ai/openai'
import { enrichLeadContext } from '@/lib/agent/enrich-context'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const requestSchema = z.object({
  queueId: z.string().uuid(),
})

function buildPrompt(params: {
  company_name: string
  location: string | null
  offer: string
  angles: string[]
  context: Awaited<ReturnType<typeof enrichLeadContext>>
}): string {
  const { company_name, location, offer, angles, context } = params

  const websiteHint = context.enriched
    ? `I saw their website mentions: "${context.h1 || context.title}"\nIt looks like they're focused on: "${context.description}"`
    : `Infer from their business name what they likely do and care about.`

  const angleList = angles.length > 0 ? angles.map((a) => `- ${a}`).join('\n') : '- Help them grow their business'

  return `You are an expert at writing short, personalized cold outreach emails.

TARGET BUSINESS:
- Name: ${company_name}
- Location: ${location || 'Unknown'}

WEBSITE CONTEXT:
${websiteHint}

OFFER:
${offer}

MESSAGING ANGLES:
${angleList}

TASK:
Write a cold outreach email (3–4 sentences, plain text, no subject line).
- Open with a specific, natural reference to their business or focus area
- Connect it to the offer in one clear sentence
- End with a soft, low-pressure call to action
- Tone: direct, confident, human — not salesy

Output ONLY the email body. No subject. No sign-off.`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const { data: lead, error: leadError } = await supabase
      .from('agent_lead_queue')
      .select('id, business_name, website, location, icp_id')
      .eq('id', parsed.data.queueId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (leadError || !lead) {
      return NextResponse.json({ error: 'LEAD_NOT_FOUND' }, { status: 404 })
    }

    const { data: icp } = await supabase
      .from('agent_icp')
      .select('raw_input, structured_output')
      .eq('id', lead.icp_id)
      .eq('user_id', user.id)
      .maybeSingle()

    const offer = String(icp?.raw_input || '').trim() || 'a lead generation tool for businesses'
    const structured = icp?.structured_output as Record<string, unknown> | null
    const angles = Array.isArray(structured?.messaging_angles)
      ? (structured.messaging_angles as string[]).filter((a) => typeof a === 'string')
      : []

    // Mark context as in-progress
    await supabase
      .from('agent_lead_queue')
      .update({ context_status: 'enriching', draft_status: 'pending' })
      .eq('id', lead.id)

    const context = await enrichLeadContext({
      company_name: lead.business_name,
      website: lead.website,
    })

    const prompt = buildPrompt({
      company_name: lead.business_name || 'this business',
      location: lead.location,
      offer,
      angles,
      context,
    })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You write short, personalized cold outreach emails. Output only the email body.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
    })

    const draft = completion.choices[0].message.content?.trim() || ''

    await supabase
      .from('agent_lead_queue')
      .update({
        context_status: context.enriched ? 'enriched' : 'basic',
        draft_status: draft ? 'ready' : 'failed',
        draft_email: draft || null,
      })
      .eq('id', lead.id)

    return NextResponse.json({ success: true, draft, enriched: context.enriched })
  } catch (error) {
    console.error('[generate-draft] error:', error)
    return NextResponse.json({ error: 'GENERATION_FAILED' }, { status: 500 })
  }
}
