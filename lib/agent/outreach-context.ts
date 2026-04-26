import type { SelectedCta } from '@/lib/agent/user-ctas'

export type UserContext = {
  name?: string
  company?: string
  website?: string
  offer?: string
}

export type LeadContext = {
  companyName?: string
  industry?: string
  location?: string
  description?: string
}

export const FORBIDDEN_TOKENS = [
  'alpa',
  'mindra',
  'mindrasolutions.com',
]

export function sanitize(text: string): string {
  let clean = text

  FORBIDDEN_TOKENS.forEach((token) => {
    const regex = new RegExp(token, 'gi')
    clean = clean.replace(regex, '')
  })

  return clean.trim()
}

export function formatCTA(cta: SelectedCta | null): string {
  if (!cta || cta.type === 'none') {
    return ''
  }

  switch (cta.type) {
    case 'link':
      return cta.label && cta.value ? `${cta.label}: ${cta.value}` : cta.value || ''
    case 'email':
      return cta.value ? `You can reach me at ${cta.value}` : ''
    case 'calendly':
      return cta.value ? `If it makes sense, here is my calendar: ${cta.value}` : ''
    default:
      return ''
  }
}

export function buildPromptContext(
  user: UserContext,
  lead: LeadContext,
  cta: SelectedCta | null
): string {
  const prompt = `
Write a short, natural outbound email.

Context:
- Sender: ${user.name || 'Unknown'}
- Company: ${user.company || 'Not specified'}
- Website: ${user.website || 'Not specified'}
- Offer: ${user.offer || 'Not specified'}

Target:
- Company: ${lead.companyName || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}
- Location: ${lead.location || 'Unknown'}
- Description: ${lead.description || 'Unknown'}

Instructions:
- Keep it human and conversational
- Avoid generic marketing language
- Do NOT mention any product, brand, or platform unless explicitly provided
- Do NOT invent tools or services
- If no CTA is provided, end naturally without any link

CTA:
${cta ? JSON.stringify(cta) : 'none'}
`

  return sanitize(prompt)
}
