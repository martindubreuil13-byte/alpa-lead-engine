// robots.txt support (RFC 9309), conservative where permission cannot be determined.
//
// What a fetch of /robots.txt means:
//   2xx text          -> parse it; its rules apply
//   2xx that is HTML  -> a site that answers every path with its homepage: no rules (allow)
//   404, 410, other 4xx (not 429) -> "unavailable": no rules (allow). RFC 9309 section 2.3.1.3.
//   429, 5xx, timeout, network or TLS error, redirect off the site, unreadable body
//                     -> "unknown": permission CANNOT be determined, so nothing is requested.
// An unknown result is never read as permission to crawl.
//
// Matching: the group naming ALPA's product token wins (longest specific match; groups with the
// same agent are merged), otherwise "*". The longest matching rule wins, Allow wins ties; "*" and
// a trailing "$" work in patterns; paths are compared after percent-encoding normalisation.

export type RobotsRule = { allow: boolean; pattern: string }
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] }

/** RFC 9309 asks crawlers to parse at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 512_000
const MAX_RULES = 5_000
const MAX_PATTERN_LENGTH = 2_000

export type RobotsPolicy = (
  | { kind: 'rules'; groups: RobotsGroup[] }
  | { kind: 'allow_all'; reason: 'not_found' | 'unavailable' | 'not_robots' }
  | { kind: 'unknown'; reason: 'timeout' | 'network' | 'server_error' | 'rate_limited' | 'off_site' | 'unreadable' }
) & {
  /** Set when /robots.txt was served from a different (related) origin than the one asked for, e.g. http -> https. */
  canonicalOrigin?: string
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let previousWasAgent = false
  let ruleCount = 0

  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match) continue

    const field = match[1].toLowerCase()
    const value = match[2].trim()

    if (field === 'user-agent') {
      if (!current || !previousWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      previousWasAgent = true
      continue
    }

    previousWasAgent = false
    if (!current || (field !== 'allow' && field !== 'disallow') || !value) continue
    if (value.length > MAX_PATTERN_LENGTH || ++ruleCount > MAX_RULES) continue
    // "Disallow: private/" is a sloppy "/private/"; a pattern must start with "/" or "*".
    const pattern = value.startsWith('/') || value.startsWith('*') ? value : `/${value}`
    current.rules.push({ allow: field === 'allow', pattern })
  }

  return groups
}

/** The product token of a User-Agent string: "ALPA-Business-Intelligence/1.0 (...)" -> "alpa-business-intelligence". */
export function productToken(userAgent: string): string {
  return (userAgent.trim().split(/[\/\s(]/)[0] || '').toLowerCase()
}

export function selectRobotsRules(groups: RobotsGroup[], userAgent: string): RobotsRule[] {
  const token = productToken(userAgent)

  // The most specific agent line that names us: "alpa-business-intelligence" beats "alpa".
  let bestLength = 0
  if (token) {
    for (const group of groups) {
      for (const agent of group.agents) {
        if (agent !== '*' && agent.length > bestLength && (token === agent || token.startsWith(agent))) bestLength = agent.length
      }
    }
  }

  const matching = bestLength > 0
    ? groups.filter((group) => group.agents.some((agent) => agent !== '*' && agent.length === bestLength && (token === agent || token.startsWith(agent))))
    : groups.filter((group) => group.agents.includes('*'))

  return matching.flatMap((group) => group.rules) // groups with the same agent are combined
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** Percent-encoding compared by octet: %7e == ~, %2f stays %2F. */
function normalizeEncoding(value: string): string {
  return value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16))
    return /[A-Za-z0-9\-._~]/.test(char) ? char : `%${hex.toUpperCase()}`
  })
}

/** Glob match where "*" is any run of characters and a trailing "$" anchors the end. No regex backtracking. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/\*+/g, '*')

  let p = 0
  let s = 0
  let starAt = -1
  let resumeAt = 0

  while (s < path.length) {
    // Patterns are prefixes: once the whole pattern has matched, the rest of the path does not matter,
    // unless the pattern is anchored with "$".
    if (p === body.length && !anchored) return true
    if (p < body.length && body[p] === '*') { starAt = p++; resumeAt = s; continue }
    if (p < body.length && body[p] === path[s]) { p++; s++; continue }
    if (starAt >= 0) { p = starAt + 1; s = ++resumeAt; continue }
    return false
  }
  while (p < body.length && body[p] === '*') p++
  return p >= body.length
}

/** `pathWithQuery` is the URL path plus query string, e.g. "/contact?x=1". */
export function isPathAllowed(rules: RobotsRule[], pathWithQuery: string): boolean {
  const path = normalizeEncoding(pathWithQuery)
  let best: RobotsRule | null = null
  for (const rule of rules) {
    if (!matches(normalizeEncoding(rule.pattern), path)) continue
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
  }
  return !best || best.allow
}

export function isUrlAllowed(rules: RobotsRule[], url: string): boolean {
  try {
    const parsed = new URL(url)
    return isPathAllowed(rules, `${parsed.pathname}${parsed.search}`)
  } catch {
    return false // a URL we cannot read is not one we should request
  }
}

// ---------------------------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------------------------

/** Turns an HTTP response for /robots.txt into a policy. */
export function interpretRobotsResponse(response: { status: number; contentType?: string | null; body?: string }): RobotsPolicy {
  const { status } = response
  if (status === 404 || status === 410) return { kind: 'allow_all', reason: 'not_found' }
  if (status === 429) return { kind: 'unknown', reason: 'rate_limited' }
  if (status >= 500) return { kind: 'unknown', reason: 'server_error' }
  if (status >= 400) return { kind: 'allow_all', reason: 'unavailable' }
  if (status < 200 || status >= 300) return { kind: 'unknown', reason: 'unreadable' }

  const body = response.body ?? ''
  const type = (response.contentType ?? '').toLowerCase()
  const looksLikeHtml = /^\s*(<!doctype html|<html|<head|<body)/i.test(body) || (type.includes('html') && /<\/?(html|body|head|div|script)\b/i.test(body))
  if (looksLikeHtml) return { kind: 'allow_all', reason: 'not_robots' }
  if (type && !type.startsWith('text/') && !type.includes('octet-stream')) return { kind: 'unknown', reason: 'unreadable' }

  return { kind: 'rules', groups: parseRobots(body.slice(0, ROBOTS_MAX_BYTES)) }
}

/** May `url` be requested under this policy by `userAgent`? Unknown means no. */
export function isAllowedByPolicy(policy: RobotsPolicy, userAgent: string, url: string): boolean {
  if (policy.kind === 'allow_all') return true
  if (policy.kind === 'unknown') return false
  return isUrlAllowed(selectRobotsRules(policy.groups, userAgent), url)
}

// ---------------------------------------------------------------------------------------------
// Bounded cache with in-flight de-duplication
// ---------------------------------------------------------------------------------------------

export type RobotsCacheOptions = {
  maxEntries?: number
  /** How long a definite answer (rules or allow-all) is reused. */
  ttlMs?: number
  /** How long an "unknown" answer is reused (short: it is usually a transient failure). */
  unknownTtlMs?: number
  now?: () => number
}

export type RobotsCacheStats = { hits: number; misses: number; joined: number; evictions: number; size: number }

/**
 * Process-local only. On a serverless platform an instance may be reused for later requests or
 * discarded at any time, so nothing relies on a hit: a miss just means fetching robots.txt again.
 * Keys are origins ("https://example.com"), so policy never crosses origins. The cached value is the
 * parsed policy for ALL agents; each caller evaluates it for its own user agent.
 */
export function createRobotsCache(options: RobotsCacheOptions = {}) {
  const maxEntries = options.maxEntries ?? 200
  const ttlMs = options.ttlMs ?? 10 * 60_000
  const unknownTtlMs = options.unknownTtlMs ?? 30_000
  const now = options.now ?? Date.now

  const entries = new Map<string, { policy: RobotsPolicy; expiresAt: number }>()
  const pending = new Map<string, Promise<RobotsPolicy>>()
  const stats = { hits: 0, misses: 0, joined: 0, evictions: 0 }

  const keyOf = (origin: string) => origin.trim().toLowerCase().replace(/\/+$/, '')

  async function get(origin: string, load: () => Promise<RobotsPolicy>): Promise<RobotsPolicy> {
    const key = keyOf(origin)

    const cached = entries.get(key)
    if (cached) {
      if (cached.expiresAt > now()) {
        entries.delete(key)
        entries.set(key, cached) // most recently used
        stats.hits += 1
        return cached.policy
      }
      entries.delete(key)
    }

    const inFlight = pending.get(key)
    if (inFlight) {
      stats.joined += 1
      return inFlight
    }

    stats.misses += 1
    const promise = load()
      .then((policy) => {
        entries.set(key, { policy, expiresAt: now() + (policy.kind === 'unknown' ? unknownTtlMs : ttlMs) })
        while (entries.size > maxEntries) {
          entries.delete(entries.keys().next().value as string)
          stats.evictions += 1
        }
        return policy
      })
      .finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
  }

  return {
    get,
    clear() { entries.clear() },
    stats: (): RobotsCacheStats => ({ ...stats, size: entries.size }),
  }
}

export type RobotsCache = ReturnType<typeof createRobotsCache>
