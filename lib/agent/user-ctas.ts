export type UserCtaType = 'link' | 'email' | 'calendly' | 'text' | 'none'

export type SelectedCta = {
  id?: string | null
  label: string | null
  type: UserCtaType
  value: string | null
  is_active?: boolean | null
}

const URL_RE = /^https?:\/\/\S+$/i
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?\b/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i

function ensureUrlProtocol(value: string) {
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value.replace(/^\/+/, '')}`
}

function inferCtaTypeFromText(value: string): UserCtaType {
  const trimmed = value.trim()
  if (!trimmed) return 'none'
  if (/@/.test(trimmed) && EMAIL_RE.test(trimmed.match(/[^\s]+@[^\s]+/) ? trimmed.match(/[^\s]+@[^\s]+/)![0] : '')) {
    return 'email'
  }
  if (/calendly/i.test(trimmed)) return 'calendly'
  if (/https?:\/\//i.test(trimmed) || DOMAIN_RE.test(trimmed)) return 'link'
  return 'text'
}

function extractStructuredCtaFromString(raw: string): SelectedCta | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const emailMatch = trimmed.match(/[^\s]+@[^\s]+\.[^\s]+/i)?.[0] ?? null
  const urlMatch = trimmed.match(/https?:\/\/\S+/i)?.[0] ?? trimmed.match(DOMAIN_RE)?.[0] ?? null

  if (emailMatch) {
    const label = trimmed.replace(emailMatch, '').replace(/[.:]\s*$/, '').trim() || 'Reply here'
    return {
      label,
      type: 'email',
      value: emailMatch,
      is_active: true,
    }
  }

  if (urlMatch) {
    const type: UserCtaType = /calendly/i.test(urlMatch) || /calendly/i.test(trimmed) ? 'calendly' : 'link'
    const label = trimmed.replace(urlMatch, '').replace(/[.:]\s*$/, '').trim() || (type === 'calendly' ? 'Book a call' : 'Learn more')
    return {
      label,
      type,
      value: ensureUrlProtocol(urlMatch),
      is_active: true,
    }
  }

  return {
    label: trimmed,
    type: 'text',
    value: null,
    is_active: true,
  }
}

export function normalizeCtaValue(type: UserCtaType, value: string | null | undefined) {
  const trimmed = String(value || '').trim()
  if (type === 'none') return null
  if (!trimmed) return null
  if (type === 'link' || type === 'calendly') {
    return /^https?:\/\//i.test(trimmed) || !DOMAIN_RE.test(trimmed)
      ? trimmed
      : ensureUrlProtocol(trimmed)
  }
  return trimmed
}

export function isValidCtaValue(type: UserCtaType, value: string | null | undefined) {
  const normalized = normalizeCtaValue(type, value)

  if (type === 'none') return true
  if (type === 'text') return true
  if (!normalized) return false

  if (type === 'email') return EMAIL_RE.test(normalized)
  return URL_RE.test(normalized)
}

export function normalizeMissionCta(raw: unknown): SelectedCta | null {
  if (typeof raw === 'string') {
    return extractStructuredCtaFromString(raw)
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const candidate = raw as Record<string, unknown>
  const rawLabel = typeof candidate.label === 'string' ? candidate.label.trim() : ''
  const rawValue = typeof candidate.value === 'string' ? candidate.value.trim() : ''
  const combinedText = [rawLabel, rawValue].filter(Boolean).join('. ').trim()
  const rawType = String(candidate.type || '').trim() as UserCtaType
  const inferredType = inferCtaTypeFromText(rawValue || rawLabel || combinedText)
  const normalizedType: UserCtaType =
    rawType === 'link' ||
    rawType === 'email' ||
    rawType === 'calendly' ||
    rawType === 'text' ||
    rawType === 'none'
      ? (rawType === 'none' && combinedText ? inferredType : rawType)
      : inferredType
  const normalizedFromString =
    !rawValue && rawLabel && (normalizedType === 'link' || normalizedType === 'email' || normalizedType === 'calendly')
      ? extractStructuredCtaFromString(rawLabel)
      : null
  const label = normalizedFromString?.label ?? (rawLabel || null)
  const value = normalizedFromString?.value ?? normalizeCtaValue(normalizedType, rawValue)
  const isActive =
    typeof candidate.is_active === 'boolean'
      ? candidate.is_active
      : typeof candidate.isActive === 'boolean'
        ? candidate.isActive
        : true

  if (!isValidCtaValue(normalizedType, value)) {
    if (normalizedType !== 'none' && normalizedType !== 'text') {
      return null
    }
  }

  return {
    id: typeof candidate.id === 'string' ? candidate.id : null,
    label,
    type: normalizedType,
    value,
    is_active: isActive,
  }
}

export function parseMissionCtas(raw: unknown): SelectedCta[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item) => normalizeMissionCta(item))
    .filter((item): item is SelectedCta => Boolean(item))
}

export function legacyMissionCtaToSelectedCta(raw: string | null | undefined): SelectedCta | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  return extractStructuredCtaFromString(trimmed)
}

export function getMissionCTA(
  missionOrCtas:
    | { ctas?: unknown; cta?: string | null }
    | unknown[] 
    | null
    | undefined,
  emailIndex: number
): SelectedCta | null {
  const missionCtas = Array.isArray(missionOrCtas)
    ? parseMissionCtas(missionOrCtas)
    : parseMissionCtas((missionOrCtas as { ctas?: unknown } | null | undefined)?.ctas)

  const active = missionCtas.filter((cta) => cta.is_active !== false)
  if (active.length > 0) {
    return active[Math.abs(emailIndex) % active.length]!
  }

  if (!Array.isArray(missionOrCtas)) {
    return legacyMissionCtaToSelectedCta(
      (missionOrCtas as { cta?: string | null } | null | undefined)?.cta
    )
  }

  return null
}
