// Email enrichment: the entry point used by the Discover scrape paths.
//
// V2 reads a business website in at most two rounds:
//   1. the homepage and the known contact paths, requested at the same time
//   2. only if no relevant (high/medium) email was found and at least one page loaded:
//      up to MAX_FOLLOW_UP_PAGES more pages the homepage itself advertises (contact, about,
//      legal, privacy in several languages), then language-appropriate privacy-page guesses
// V1 fetched the homepage first and the contact pages second, so V2 never waits for more rounds
// than V1 did, and finishes after one round whenever the first round is enough.
//
// Every request goes through safeFetchWebsite: public HTTP(S) only, the connection itself is
// pinned to the validated address (no DNS re-resolution), bounded redirects, body and time.
// EMAIL_INTELLIGENCE_VERSION=v1 switches back to the original behaviour without a code change.

import {
  resolvePublicAddresses,
  safeFetchWebsite,
  WebsiteFetchError,
  type WebsiteFailure,
} from '../commercial-intelligence/safe-website-fetch.ts'
import { createPinnedFetch, systemResolver, type PinnedFetch, type ResolvedAddress } from '../commercial-intelligence/pinned-fetch.ts'
import {
  createRobotsCache,
  interpretRobotsResponse,
  isAllowedByPolicy,
  ROBOTS_MAX_BYTES,
  type RobotsCache,
  type RobotsPolicy,
  type RobotsRule,
} from '../commercial-intelligence/robots.ts'
import { getWebsiteUserAgent } from '../commercial-intelligence/user-agent.ts'
import { getWebsiteHost, hostsClearlyRelated, isBlockedWebsiteHost, sanitizeWebsite } from '../validation.ts'
import type { EmailValidationResult } from '../validation.ts'
import { enrichEmailV1 } from './email-enrichment-v1.ts'
import { inspectionFromOutcome, type EmailInspection } from './email-inspection.ts'
import {
  classifyEmailOutcome,
  extractEmailCandidatesV2,
  isRelevantEmail,
  pickBestEmailCandidateV2,
  planFollowUpUrls,
  planStageOneUrls,
  type EmailCandidateV2,
  type EmailCoverageClass,
} from './email-intelligence.ts'

export const FETCH_TIMEOUT_MS = 6_000
export const MAX_PAGE_BYTES = 1_500_000
// A real site (cirrusconsultinggroup.com) answers robots.txt in about 3.0 s, which the previous limit of
// 3 s turned into "permission unknown" and therefore "no pages read". Six seconds matches the page limit.
// A robots.txt that is still unanswered after that remains UNKNOWN: nothing on the site is requested.
export const ROBOTS_TIMEOUT_MS = 6_000

export type FetchedPage = { html: string; resolvedUrl: string; truncated?: boolean }

/** Why a page could not be read. `not_found` is ordinary (a guessed path that does not exist). */
export type PageFailure = WebsiteFailure | 'not_found' | 'robots'
export type PageFetchResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; failure: PageFailure; challenge?: boolean }

/** Fetchers may return a page, a failure, or null (treated as "unavailable"). */
export type PageFetcher = (url: string) => Promise<FetchedPage | PageFetchResult | null>

/** The reason a website produced no verdict. Precedence is the order listed. */
export type AccessFailure = 'robots' | 'blocked' | 'timeout' | 'too_large' | 'unsupported' | 'unavailable' | 'unsafe'
const ACCESS_PRECEDENCE: AccessFailure[] = ['robots', 'blocked', 'timeout', 'too_large', 'unsupported', 'unavailable', 'unsafe']

export type EmailEnrichmentOutcome = {
  best: EmailCandidateV2 | null
  coverageClass: EmailCoverageClass
  /** Set when the site could not be analysed. Never set for "analysed, no email published". */
  accessFailure: AccessFailure | null
  /** True when some page failed for a reason other than not existing (the verdict may be partial). */
  partialAccess: boolean
  /** True when at least one page was larger than the byte limit and only its start was read. */
  truncated: boolean
  /** Pages requested, loaded, and the number of sequential network rounds used. */
  pagesRequested: number
  pagesLoaded: number
  rounds: number
  /** Failed pages by reason (a guessed path that does not exist is `not_found`). */
  failureCounts: Partial<Record<PageFailure, number>>
  /** Pages that were anti-bot interstitials. */
  challengePages: number
  durationMs: number
  /** What robots.txt said: its rules, "no file" (allow all), could not be determined (nothing requested), or not consulted. */
  robots: 'rules' | 'allow_all' | 'unknown' | 'skipped'
  robotsReason: string | null
  /** True when pages were requested at the canonical origin that robots.txt's own redirect revealed. */
  rebased: boolean
  /** Connections opened ahead of the page requests while robots.txt was in flight, and how many were used. */
  warmed: { opened: number; used: number }
}

export type EmailEnrichmentDeps = {
  fetchPage?: PageFetcher
  /**
   * Returns the robots.txt policy for a site. A plain rule list is accepted for convenience and means
   * "these rules apply to ALPA".
   */
  fetchRobots?: (website: string) => Promise<RobotsPolicy | RobotsRule[]>
  /** Network wiring for the built-in fetchers (tests and benchmarks). Absent means production defaults. */
  transportOptions?: TransportOptions & {
    userAgent?: string
    robotsCache?: RobotsCache | null
    robotsTimeoutMs?: number
    robotsRetryDelayMs?: number
  }
  /** Transport optimisations; both default to on. Turning them off reproduces the V2.2 request sequence. */
  optimizations?: { warm?: boolean; rebase?: boolean }
}

function failureOf(error: unknown): PageFailure {
  if (error instanceof WebsiteFetchError) {
    if (error.failure === 'unavailable' && (error.statusCode === 404 || error.statusCode === 410)) return 'not_found'
    return error.failure
  }
  return 'unavailable'
}

type TransportOptions = {
  fetchImpl?: typeof fetch
  resolveHostname?: (hostname: string) => Promise<string[]>
}

/**
 * Name resolution for one website visit. The hostname is resolved ONCE, the answer is validated at
 * connect time by the pinned transport, and every request to that host (pre-check, robots.txt,
 * each page) reuses that same answer. That keeps the connection pinned to what was validated and
 * stops one site from costing five getaddrinfo calls on Node's small shared thread pool.
 */
function createTransportContext(options: TransportOptions): { fetchImpl: typeof fetch | undefined; resolveHostname: (hostname: string) => Promise<string[]> } {
  if (options.fetchImpl || options.resolveHostname) {
    const lookup = options.resolveHostname ?? resolvePublicAddresses
    const memo = new Map<string, Promise<string[]>>()
    return {
      fetchImpl: options.fetchImpl,
      resolveHostname: (hostname) => {
        let pending = memo.get(hostname)
        if (!pending) memo.set(hostname, (pending = lookup(hostname)))
        return pending
      },
    }
  }

  const memo = new Map<string, Promise<ResolvedAddress[]>>()
  const resolve = (hostname: string, family: number) => {
    let pending = memo.get(hostname)
    if (!pending) memo.set(hostname, (pending = systemResolver(hostname, 0)))
    return pending.then((addresses) => {
      const matching = family === 4 || family === 6 ? addresses.filter((entry) => entry.family === family) : addresses
      return matching.length > 0 || addresses.length === 0 ? matching : addresses
    })
  }
  return {
    fetchImpl: createPinnedFetch({ resolve }),
    resolveHostname: (hostname) => resolve(hostname, 0).then((addresses) => addresses.map((entry) => entry.address)),
  }
}

/** Builds the production page fetcher: safe, pinned fetch with a per-lead DNS memo and a same-site redirect rule. */
export function createSafePageFetcher(
  siteHost: string,
  options: TransportOptions & {
    timeoutMs?: number
    maxBytes?: number
    /** Overrides the configured ALPA user agent (used by controlled comparisons only). */
    userAgent?: string
  } = {}
): PageFetcher {
  const context = createTransportContext(options)
  const resolveHostname = context.resolveHostname

  return async (url) => {
    try {
      const result = await safeFetchWebsite(url, {
        timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
        maxBytes: options.maxBytes ?? MAX_PAGE_BYTES,
        truncateAtMaxBytes: true,
        lenientContentType: true,
        detectBotChallenge: true,
        userAgent: options.userAgent, // undefined = the configured ALPA user agent
        fetchImpl: context.fetchImpl,
        resolveHostname,
        isRedirectAllowed: (target) => {
          const host = getWebsiteHost(target.toString())
          return Boolean(host && !isBlockedWebsiteHost(host) && hostsClearlyRelated(siteHost, host))
        },
      })
      return { ok: true, page: { html: result.html, resolvedUrl: result.url, truncated: result.truncated } }
    } catch (error) {
      return { ok: false, failure: failureOf(error), challenge: error instanceof WebsiteFetchError && error.challenge }
    }
  }
}

/** Shared by every visit in this process. Bounded, short-lived, and never relied upon: a miss only costs a fetch. */
export const defaultRobotsCache: RobotsCache = createRobotsCache({ maxEntries: 200, ttlMs: 10 * 60_000, unknownTtlMs: 30_000 })

const ROBOTS_RETRY_DELAY_MS = 250
// A timeout is not retried: the server is slow, and a second wait would only double the delay.
const RETRYABLE: ReadonlyArray<string> = ['network', 'server_error']

/**
 * Reads the site's robots.txt with the same secure transport and turns the answer into a policy.
 * No file or a 4xx means "no restrictions"; a timeout, network error, 5xx or off-site redirect means the
 * permission is UNKNOWN, and nothing is requested. Fast failures (network error, 5xx) get one quick retry.
 * Concurrent lookups for one origin share a single request, and answers are cached per origin.
 */
export function createRobotsFetcher(
  siteHost: string,
  options: TransportOptions & {
    userAgent?: string
    timeoutMs?: number
    /** `null` disables caching. Default: the shared cache, unless the network is injected (tests). */
    cache?: RobotsCache | null
    retryDelayMs?: number
  } = {}
): (website: string) => Promise<RobotsPolicy> {
  const cache = options.cache !== undefined ? options.cache : options.fetchImpl || options.resolveHostname ? null : defaultRobotsCache

  const fetchOnce = async (website: string): Promise<RobotsPolicy> => {
    const origin = new URL(website).origin
    try {
      const result = await safeFetchWebsite(new URL('/robots.txt', origin).toString(), {
        timeoutMs: options.timeoutMs ?? ROBOTS_TIMEOUT_MS,
        maxBytes: ROBOTS_MAX_BYTES,
        truncateAtMaxBytes: true,
        lenientContentType: true,
        userAgent: options.userAgent, // undefined = the configured ALPA user agent
        fetchImpl: options.fetchImpl,
        resolveHostname: options.resolveHostname,
        isRedirectAllowed: (target) => {
          const host = getWebsiteHost(target.toString())
          return Boolean(host && !isBlockedWebsiteHost(host) && hostsClearlyRelated(siteHost, host))
        },
      })
      const policy: RobotsPolicy = interpretRobotsResponse({ status: result.statusCode, body: result.html })
      const finalOrigin = new URL(result.url).origin
      return finalOrigin !== origin ? { ...policy, canonicalOrigin: finalOrigin } : policy
    } catch (error) {
      if (!(error instanceof WebsiteFetchError)) return { kind: 'unknown', reason: 'network' }
      if (error.statusCode) return interpretRobotsResponse({ status: error.statusCode })
      if (error.failure === 'timeout') return { kind: 'unknown', reason: 'timeout' }
      if (error.code === 'UNSAFE_URL') return { kind: 'unknown', reason: 'off_site' }
      if (error.failure === 'unsupported') return { kind: 'unknown', reason: 'unreadable' }
      return { kind: 'unknown', reason: 'network' }
    }
  }

  const load = async (website: string): Promise<RobotsPolicy> => {
    const first = await fetchOnce(website)
    if (first.kind !== 'unknown' || !RETRYABLE.includes(first.reason)) return first
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? ROBOTS_RETRY_DELAY_MS))
    return fetchOnce(website)
  }

  return (website) => (cache ? cache.get(new URL(website).origin, () => load(website)) : load(website))
}

/** Robots.txt handling can be switched off server-side if its latency cost is not wanted. Default: on. */
export function emailRobotsEnabled(value: string | undefined | null): boolean {
  return !['off', 'false', '0', 'no', 'disabled'].includes(String(value ?? '').trim().toLowerCase())
}

/** Page and robots.txt fetchers for one website visit, sharing a single validated name resolution. */
export function createEmailTransport(
  siteHost: string,
  options: TransportOptions & { userAgent?: string; robotsCache?: RobotsCache | null; robotsTimeoutMs?: number; robotsRetryDelayMs?: number } = {}
) {
  const context = createTransportContext(options)
  const shared = { fetchImpl: context.fetchImpl, resolveHostname: context.resolveHostname, userAgent: options.userAgent }
  const pinned = context.fetchImpl as Partial<PinnedFetch> | undefined
  return {
    fetchPage: createSafePageFetcher(siteHost, shared),
    fetchRobots: createRobotsFetcher(siteHost, {
      ...shared,
      ...(options.robotsCache !== undefined ? { cache: options.robotsCache } : {}),
      timeoutMs: options.robotsTimeoutMs,
      retryDelayMs: options.robotsRetryDelayMs,
    }),
    /** Opens connections ahead of time. Sends no request. A no-op when the network is injected without support. */
    warm: (url: string, count: number) => pinned?.warm?.(url, count),
    /** Closes connections nobody used. */
    close: () => pinned?.closeWarm?.(),
    warmStats: () => pinned?.warmStats?.() ?? { opened: 0, used: 0, discarded: 0 },
  }
}

function normalizeFetch(result: FetchedPage | PageFetchResult | null): PageFetchResult {
  if (!result) return { ok: false, failure: 'unavailable' }
  if ('ok' in result) return result
  return { ok: true, page: result }
}

/** Why a robots.txt that could not be read stops the visit, in the vocabulary of access failures. */
const UNKNOWN_ROBOTS_ACCESS: Record<string, AccessFailure> = {
  timeout: 'timeout',
  network: 'unavailable',
  server_error: 'unavailable',
  rate_limited: 'blocked',
  off_site: 'unavailable',
  unreadable: 'unsupported',
}

function toPolicy(value: RobotsPolicy | RobotsRule[]): RobotsPolicy {
  return Array.isArray(value) ? { kind: 'rules', groups: [{ agents: ['*'], rules: value }] } : value
}

/** Same page, canonical origin: "http://a.com/x?y" -> "https://www.a.com/x?y". */
function rebase(url: string, from: string, to: string): string {
  return url.startsWith(from) ? `${to}${url.slice(from.length)}` : url
}

export async function enrichEmailV2(
  website: string | null,
  deps: EmailEnrichmentDeps = {}
): Promise<EmailEnrichmentOutcome> {
  const empty = (): EmailEnrichmentOutcome => ({
    best: null,
    coverageClass: 'unanalyzable',
    accessFailure: 'unsafe',
    partialAccess: false,
    truncated: false,
    pagesRequested: 0,
    pagesLoaded: 0,
    rounds: 0,
    failureCounts: {},
    challengePages: 0,
    durationMs: 0,
    robots: 'skipped',
    robotsReason: null,
    rebased: false,
    warmed: { opened: 0, used: 0 },
  })

  const base = sanitizeWebsite(website)
  if (!base) return empty()

  const siteHost = getWebsiteHost(base)
  if (!siteHost || isBlockedWebsiteHost(siteHost)) return empty()

  const startedAt = Date.now()
  const userAgent = deps.transportOptions?.userAgent ?? getWebsiteUserAgent()

  // One transport per visit: one validated name resolution shared by robots.txt and every page.
  // An injected page fetcher owns all network access (tests never reach the internet).
  const needsTransport = !(deps.fetchPage && deps.fetchRobots)
  const transport = needsTransport ? createEmailTransport(siteHost, deps.transportOptions) : null
  const fetchPage = deps.fetchPage ?? transport!.fetchPage
  const robotsOn = Boolean(deps.fetchRobots) || (!deps.fetchPage && emailRobotsEnabled(process.env.EMAIL_INTELLIGENCE_ROBOTS))
  const fetchRobots = deps.fetchRobots ?? (robotsOn ? transport!.fetchRobots : async () => [] as RobotsRule[])

  const requested = new Set<string>() // absolute URLs already asked for or loaded
  const candidates: EmailCandidateV2[] = []
  const state: { homepage: FetchedPage | null } = { homepage: null }
  const failures: PageFailure[] = []
  let challengePages = 0
  let truncated = false
  let pagesRequested = 0
  let pagesLoaded = 0
  let rounds = 0
  let pageBase = base
  let rebased = false
  let policy: RobotsPolicy = { kind: 'allow_all', reason: 'unavailable' }

  try {
    // Open the connections for robots.txt AND for the first page round all at once: DNS, TCP and TLS for
    // the pages overlap with the robots.txt round trip. The robots.txt request takes one of them, the
    // page round takes the rest. No page is requested until permission is known.
    if (transport && robotsOn && deps.optimizations?.warm !== false) {
      transport.warm(base, planStageOneUrls(base).length + 1)
    }

    // robots.txt first: a page ALPA is asked not to visit, or whose permission cannot be determined,
    // is never requested.
    if (robotsOn) policy = toPolicy(await fetchRobots(base))

    // The site told us (by redirecting robots.txt) where it really lives: ask for pages there, so every
    // page does not pay the same redirect again. Same site only, never a scheme downgrade.
    if (policy.canonicalOrigin && deps.optimizations?.rebase !== false) {
      const from = new URL(base).origin
      const target = new URL(policy.canonicalOrigin)
      const targetHost = getWebsiteHost(policy.canonicalOrigin)
      const downgrade = new URL(base).protocol === 'https:' && target.protocol === 'http:'
      if (targetHost && !isBlockedWebsiteHost(targetHost) && hostsClearlyRelated(siteHost, targetHost) && !downgrade && policy.canonicalOrigin !== from) {
        pageBase = rebase(base, from, policy.canonicalOrigin)
        rebased = true
        transport?.close() // connections opened for the old origin cannot serve the new one
      }
    }

    const fetchRound = async (candidateUrls: string[]) => {
      const urls = candidateUrls.filter((url) => {
        if (isAllowedByPolicy(policy, userAgent, url)) return true
        failures.push('robots')
        requested.add(url)
        return false
      })
      if (urls.length === 0) return

      rounds += 1
      pagesRequested += urls.length
      urls.forEach((url) => requested.add(url))

      const results = await Promise.all(urls.map(async (url) => normalizeFetch(await fetchPage(url))))
      results.forEach((result, index) => {
        if (!result.ok) {
          failures.push(result.failure)
          if (result.challenge) challengePages += 1
          return
        }

        const { page } = result
        const resolvedHost = getWebsiteHost(page.resolvedUrl)
        if (!resolvedHost || isBlockedWebsiteHost(resolvedHost) || !hostsClearlyRelated(siteHost, resolvedHost)) {
          failures.push('unavailable') // the site sent us somewhere else: nothing of this business was read
          return
        }

        pagesLoaded += 1
        if (page.truncated) truncated = true
        requested.add(page.resolvedUrl)
        if (urls[index] === pageBase) state.homepage = page

        candidates.push(
          ...extractEmailCandidatesV2({ html: page.html, pageUrl: page.resolvedUrl, websiteHost: resolvedHost })
        )
      })
    }

    await fetchRound(planStageOneUrls(pageBase))

    if (pagesLoaded > 0 && !isRelevantEmail(pickBestEmailCandidateV2(candidates))) {
      const followUps = planFollowUpUrls({ base: pageBase, homepage: state.homepage, alreadyRequested: requested })
      if (followUps.length > 0) await fetchRound(followUps)
    }
  } finally {
    transport?.close()
  }

  const best = pickBestEmailCandidateV2(candidates)
  const real = failures.filter((failure): failure is AccessFailure => failure !== 'not_found')
  const partialAccess = real.length > 0

  // An unreadable site is never reported as "no email published".
  let accessFailure: AccessFailure | null = null
  if (!best) {
    if (pagesLoaded === 0) {
      accessFailure =
        policy.kind === 'unknown'
          ? UNKNOWN_ROBOTS_ACCESS[policy.reason] ?? 'unavailable'
          : ACCESS_PRECEDENCE.find((kind) => real.includes(kind)) ?? 'unavailable'
    } else if (truncated) {
      accessFailure = 'too_large'
    }
  }

  const warmStats = transport?.warmStats() ?? { opened: 0, used: 0, discarded: 0 }
  return {
    best,
    coverageClass: classifyEmailOutcome({ best, analyzed: pagesLoaded > 0 && accessFailure === null, hasWebsite: true }),
    accessFailure,
    partialAccess,
    truncated,
    pagesRequested,
    pagesLoaded,
    rounds,
    failureCounts: failures.reduce<Partial<Record<PageFailure, number>>>((counts, failure) => {
      counts[failure] = (counts[failure] ?? 0) + 1
      return counts
    }, {}),
    challengePages,
    durationMs: Date.now() - startedAt,
    robots: robotsOn ? policy.kind : 'skipped',
    robotsReason: policy.kind === 'unknown' ? policy.reason : null,
    rebased,
    warmed: { opened: warmStats.opened, used: warmStats.used },
  }
}

export type EmailIntelligenceVersion = 'v1' | 'v2'

/** V2 is the default. Only an explicit "v1" (any case, surrounding spaces ignored) selects V1. */
export function selectEmailIntelligenceVersion(value: string | undefined | null): EmailIntelligenceVersion {
  return String(value ?? '').trim().toLowerCase() === 'v1' ? 'v1' : 'v2'
}

export type EmailEnrichers = {
  v1: (website: string | null) => Promise<EmailValidationResult | null>
  v2: (website: string | null) => Promise<EmailValidationResult | null>
}

/**
 * One line per website. It carries the host (a public business website) and counters only: never
 * an email address, never the user agent. Filter production logs on "[EMAIL-INTEL]".
 *   result = high | medium | low | none | unreadable:<blocked|timeout|too_large|unsupported|unavailable|unsafe>
 *   fail   = failed pages by reason, e.g. blocked:2,timeout:1 (not_found is routine and shown too)
 */
export function formatEmailIntelLog(website: string | null, outcome: EmailEnrichmentOutcome): string {
  const host = getWebsiteHost(website) ?? 'unknown'
  const result = outcome.accessFailure ? `unreadable:${outcome.accessFailure}` : outcome.best ? outcome.best.emailConfidence : 'none'
  const fail = Object.entries(outcome.failureCounts).map(([reason, count]) => `${reason}:${count}`).join(',')
  return [
    `[EMAIL-INTEL] host=${host}`,
    `result=${result}`,
    `pages=${outcome.pagesLoaded}/${outcome.pagesRequested}`,
    `rounds=${outcome.rounds}`,
    `ms=${outcome.durationMs}`,
    fail ? `fail=${fail}` : '',
    outcome.challengePages ? `challenge=${outcome.challengePages}` : '',
    outcome.robots === 'unknown' ? `robots=unknown:${outcome.robotsReason}` : '',
    outcome.rebased ? 'rebased' : '',
    outcome.warmed.opened ? `warm=${outcome.warmed.used}/${outcome.warmed.opened}` : '',
    outcome.truncated ? 'truncated' : '',
    outcome.partialAccess ? 'partial' : '',
  ].filter(Boolean).join(' ')
}

function logOutcome(website: string | null, outcome: EmailEnrichmentOutcome) {
  console.info(formatEmailIntelLog(website, outcome))
}

/** An address (if any) together with how well the website was inspected. V1 cannot tell, so it reports null. */
export type EmailEnrichmentResult = { record: EmailValidationResult | null; inspection: EmailInspection | null }

export type DetailedEmailEnrichers = {
  v1: (website: string | null) => Promise<EmailEnrichmentResult>
  v2: (website: string | null) => Promise<EmailEnrichmentResult>
}

const DEFAULT_DETAILED_ENRICHERS: DetailedEmailEnrichers = {
  v1: async (website) => ({ record: await enrichEmailV1(website), inspection: null }),
  v2: async (website) => {
    const outcome = await enrichEmailV2(website)
    logOutcome(website, outcome)
    return { record: outcome.best, inspection: inspectionFromOutcome(outcome) }
  },
}

const DEFAULT_ENRICHERS: EmailEnrichers = {
  v1: async (website) => (await DEFAULT_DETAILED_ENRICHERS.v1(website)).record,
  v2: async (website) => (await DEFAULT_DETAILED_ENRICHERS.v2(website)).record,
}

/**
 * The scrape paths call this. Returns the same shape V1 returned. The variable is read on every
 * call, at runtime: it is not inlined at build time, so changing it needs a restart, not a rebuild.
 */
export async function enrichEmail(
  website: string | null,
  enrichers: EmailEnrichers = DEFAULT_ENRICHERS
): Promise<EmailValidationResult | null> {
  const detailed: DetailedEmailEnrichers = {
    v1: async (site) => ({ record: await enrichers.v1(site), inspection: null }),
    v2: async (site) => ({ record: await enrichers.v2(site), inspection: null }),
  }
  return (await enrichEmailWithInspection(website, detailed)).record
}

/**
 * Same as enrichEmail, and also reports how well the website was inspected (see email-inspection.ts).
 * This is the one place the version switch is read, so V1 and V2 can still be swapped by one variable.
 */
export async function enrichEmailWithInspection(
  website: string | null,
  enrichers: DetailedEmailEnrichers = DEFAULT_DETAILED_ENRICHERS
): Promise<EmailEnrichmentResult> {
  return enrichers[selectEmailIntelligenceVersion(process.env.EMAIL_INTELLIGENCE_VERSION)](website)
}
