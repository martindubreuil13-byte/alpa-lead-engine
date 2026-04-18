type LeadIdentityInput = {
  business_name?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
}

export type LeadIdentity = {
  normalizedBusinessName: string | null
  normalizedLocation: string | null
  normalizedDomain: string | null
  normalizedPhone: string | null
  normalizedWebsite: string | null
  dedupKey: string
}

export type LeadDedupeState = {
  domains: Set<string>
  phones: Set<string>
  websites: Set<string>
  nameLocations: Set<string>
}

export function normalizeBusinessName(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return normalized || null
}

export function normalizeLocation(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return normalized || null
}

export function normalizeWebsite(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return null

  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const url = new URL(normalized)
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()
    const path = url.pathname.replace(/\/+$/, '')
    return `${host}${path}` || host || null
  } catch {
    return raw
      .replace(/^https?:\/\/(www\.)?/i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .toLowerCase()
      .trim() || null
  }
}

export function normalizeDomain(params: {
  website?: string | null
  email?: string | null
}) {
  const websiteHost = normalizeWebsite(params.website)?.split('/')[0] ?? null
  if (websiteHost) return websiteHost

  const emailDomain = String(params.email || '').trim().toLowerCase().split('@')[1] ?? ''
  return emailDomain || null
}

export function normalizePhone(value: string | null | undefined) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits || null
}

export function buildLeadIdentity(input: LeadIdentityInput): LeadIdentity {
  const normalizedBusinessName = normalizeBusinessName(input.business_name)
  const normalizedLocation = normalizeLocation(input.location)
  const normalizedWebsite = normalizeWebsite(input.website)
  const normalizedDomain = normalizeDomain({
    website: input.website,
    email: input.email,
  })
  const normalizedPhone = normalizePhone(input.phone)

  const nameLocationKey =
    normalizedBusinessName && normalizedLocation
      ? `${normalizedBusinessName}::${normalizedLocation}`
      : normalizedBusinessName
        ? `${normalizedBusinessName}::`
        : null

  const dedupKey =
    (normalizedDomain && `domain:${normalizedDomain}`) ||
    (normalizedPhone && `phone:${normalizedPhone}`) ||
    (normalizedWebsite && `website:${normalizedWebsite}`) ||
    (nameLocationKey && `name:${nameLocationKey}`) ||
    'unknown'

  return {
    normalizedBusinessName,
    normalizedLocation,
    normalizedDomain,
    normalizedPhone,
    normalizedWebsite,
    dedupKey,
  }
}

export function createLeadDedupeState(): LeadDedupeState {
  return {
    domains: new Set<string>(),
    phones: new Set<string>(),
    websites: new Set<string>(),
    nameLocations: new Set<string>(),
  }
}

export function rememberLeadIdentity(state: LeadDedupeState, identity: LeadIdentity) {
  if (identity.normalizedDomain) state.domains.add(identity.normalizedDomain)
  if (identity.normalizedPhone) state.phones.add(identity.normalizedPhone)
  if (identity.normalizedWebsite) state.websites.add(identity.normalizedWebsite)
  if (identity.normalizedBusinessName) {
    state.nameLocations.add(
      `${identity.normalizedBusinessName}::${identity.normalizedLocation ?? ''}`
    )
  }
}

export function hasLeadCollision(state: LeadDedupeState, identity: LeadIdentity) {
  if (identity.normalizedDomain && state.domains.has(identity.normalizedDomain)) return true
  if (identity.normalizedPhone && state.phones.has(identity.normalizedPhone)) return true
  if (identity.normalizedWebsite && state.websites.has(identity.normalizedWebsite)) return true
  if (identity.normalizedBusinessName) {
    const key = `${identity.normalizedBusinessName}::${identity.normalizedLocation ?? ''}`
    if (state.nameLocations.has(key)) return true
  }
  return false
}
