export type UserCtaType = 'link' | 'email' | 'calendly' | 'none'

export type SelectedCta = {
  id?: string | null
  label: string | null
  type: UserCtaType
  value: string | null
}

export type UserCtaRow = SelectedCta & {
  user_id: string
  is_active: boolean
  priority: number | null
  usage_count: number
  created_at: string
}

const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i

export function normalizeCtaValue(type: UserCtaType, value: string | null | undefined) {
  const trimmed = String(value || '').trim()
  if (type === 'none') return null
  return trimmed || null
}

export function isValidCtaValue(type: UserCtaType, value: string | null | undefined) {
  const normalized = normalizeCtaValue(type, value)

  if (type === 'none') return true
  if (!normalized) return false

  if (type === 'email') return EMAIL_RE.test(normalized)
  return URL_RE.test(normalized)
}

export function legacyMissionCtaToSelectedCta(raw: string | null | undefined): SelectedCta | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const urlMatch = trimmed.match(/https?:\/\/\S+/i)?.[0] ?? null
  const emailMatch = trimmed.match(EMAIL_RE)?.[0] ?? null

  if (urlMatch && /calendly\.com/i.test(urlMatch)) {
    return {
      label: 'Book a call',
      type: 'calendly',
      value: urlMatch,
    }
  }

  if (urlMatch) {
    return {
      label: 'Open link',
      type: 'link',
      value: urlMatch,
    }
  }

  if (emailMatch) {
    return {
      label: 'Reply by email',
      type: 'email',
      value: emailMatch,
    }
  }

  return {
    label: trimmed,
    type: 'none',
    value: null,
  }
}

export function selectCtaForEmail(
  ctas: Array<Pick<UserCtaRow, 'id' | 'label' | 'type' | 'value'>> | null | undefined,
  emailIndex: number,
  legacyMissionCta?: string | null
): SelectedCta | null {
  const active = (ctas || [])
    .filter((cta) => cta && cta.label)
    .map((cta) => ({
      id: cta.id ?? null,
      label: cta.label,
      type: cta.type,
      value: normalizeCtaValue(cta.type, cta.value),
    }))

  if (active.length > 0) {
    return active[Math.abs(emailIndex) % active.length]!
  }

  return legacyMissionCtaToSelectedCta(legacyMissionCta)
}
