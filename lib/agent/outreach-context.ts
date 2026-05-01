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

export function sanitize(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function formatCTA(cta: SelectedCta | null): string | null {
  if (!cta) return null

  switch (cta.type) {
    case 'link':
      return cta.value ? `Test it here: ${cta.value}` : null
    case 'calendly':
      return cta.value ? `Book a time: ${cta.value}` : null
    case 'email':
      return cta.value ? `Reply here: ${cta.value}` : null
    case 'text':
      return cta.label ? cta.label.trim() : null
    case 'none':
      return null
    default:
      return null
  }
}

export function buildPromptContext(
  user: UserContext,
  lead: LeadContext,
  cta: SelectedCta | null
): string {
  return `
Write a short outbound email that sounds like a real person noticing something useful.

Sender:
- Name: ${user.name || 'Unknown'}
- Company: ${user.company || 'Not specified'}
- Website: ${user.website || 'Not specified'}
- Offer: ${user.offer || 'Not specified'}

Lead:
- Company: ${lead.companyName || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}
- Location: ${lead.location || 'Unknown'}
- Description: ${lead.description || 'Unknown'}

CTA context:
${cta ? JSON.stringify(cta) : 'none'}

IMPORTANT:
Do NOT mention any product, brand, or platform unless explicitly provided in the CTA.
If no CTA is provided, do not insert any link or product reference.
You are part of an automated outbound system. You must generate the final email using provided data. You are not allowed to ask for inputs or clarification.
`
}
