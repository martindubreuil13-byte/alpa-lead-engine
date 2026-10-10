// A fetch implementation that closes the DNS-rebinding gap.
//
// The problem with "resolve, check, then fetch(url)": the HTTP client resolves the hostname a
// second time when it opens the socket, so an attacker-controlled DNS server can answer with a
// public address for the check and a private one (127.0.0.1, 169.254.169.254, ...) for the
// connection.
//
// The fix here is to stop checking and connecting as two separate steps. The socket is opened
// by Node's http/https client with a custom `lookup` function. That function is the ONLY name
// resolution the connection performs: it resolves the hostname once, refuses the connection if
// ANY returned address is non-public, and hands the validated addresses straight to the socket.
// There is no second resolution to poison. Nothing about TLS changes: the request still uses
// the original hostname for SNI and certificate verification (rejectUnauthorized stays on).
//
// Redirects are never followed here unless asked (`redirect: 'manual'`, which is how
// safeFetchWebsite uses it); each hop is a fresh request through the same validating lookup.

import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net, { isIP } from 'node:net'
import { Readable } from 'node:stream'
import zlib from 'node:zlib'

import { isNonPublicAddress } from './ip-safety.ts'

export type ResolvedAddress = { address: string; family: number }
export type AddressResolver = (hostname: string, family: number) => Promise<ResolvedAddress[]>

export class UnsafeAddressError extends Error {
  readonly code = 'ERR_UNSAFE_ADDRESS'
  constructor(message = 'Website resolves to a non-public network address') {
    super(message)
    this.name = 'UnsafeAddressError'
  }
}

export type PinnedFetchOptions = {
  /** Name resolution used at connect time. Defaults to the system resolver. */
  resolve?: AddressResolver
  /** Decides which destination addresses may be contacted. Defaults to public addresses only. */
  isAddressAllowed?: (address: string) => boolean
  /** TLS overrides for tests (a private CA). Certificate verification is never disabled here. */
  tls?: { ca?: string | Buffer | Array<string | Buffer> }
  maxRedirects?: number
  /** Longest a name lookup may take before the connection attempt fails. */
  lookupTimeoutMs?: number
  /** How long an unused pre-opened connection may idle before it is closed. */
  warmTtlMs?: number
}

/** A lookup that never answers must not hold a request forever (dns.lookup cannot be cancelled). */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

export const DEFAULT_LOOKUP_TIMEOUT_MS = 5_000

export const systemResolver: AddressResolver = (hostname, family) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true, family }, (error, addresses) => {
      if (error) reject(error)
      else resolve(addresses.map(({ address, family: version }) => ({ address, family: version })))
    })
  })

const defaultAllowed = (address: string) => !isNonPublicAddress(address)

export function stripBrackets(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/**
 * Builds the `lookup` option handed to net.connect. Exposed so tests can observe exactly what
 * the socket is allowed to connect to.
 */
export function createValidatingLookup(options: Pick<PinnedFetchOptions, 'resolve' | 'isAddressAllowed' | 'lookupTimeoutMs'> = {}) {
  const resolve = options.resolve ?? systemResolver
  const deadline = options.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS
  const allowed = options.isAddressAllowed ?? defaultAllowed

  return (
    hostname: string,
    lookupOptions: number | { family?: number | string; all?: boolean } | undefined,
    callback: (...args: any[]) => void
  ) => {
    const settings = typeof lookupOptions === 'object' && lookupOptions ? lookupOptions : {}
    const family = typeof lookupOptions === 'number' ? lookupOptions : Number(settings.family) || 0

    withDeadline(resolve(hostname, family), deadline, () => Object.assign(new Error(`getaddrinfo ETIMEDOUT ${hostname}`), { code: 'ETIMEDOUT' }))
      .then((addresses) => {
        if (addresses.length === 0) {
          throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' })
        }
        // One bad answer poisons the set: a rebinding server often mixes public and private records.
        if (addresses.some(({ address }) => !allowed(address))) throw new UnsafeAddressError()

        if (settings.all) callback(null, addresses)
        else callback(null, addresses[0].address, addresses[0].family)
      })
      .catch((error) => callback(error))
  }
}

function toHeaders(init: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  if (!init) return out
  if (init instanceof Headers) {
    init.forEach((value, key) => (out[key] = value))
  } else if (Array.isArray(init)) {
    init.forEach(([key, value]) => (out[key] = value))
  } else {
    Object.entries(init).forEach(([key, value]) => (out[key] = String(value)))
  }
  return out
}

function decodeBody(res: http.IncomingMessage): { stream: Readable; decoded: boolean } {
  const encoding = String(res.headers['content-encoding'] || '').toLowerCase().trim()
  const decoder =
    encoding === 'gzip' || encoding === 'x-gzip'
      ? zlib.createGunzip()
      : encoding === 'deflate'
        ? zlib.createInflate()
        : encoding === 'br'
          ? zlib.createBrotliDecompress()
          : null

  if (!decoder) return { stream: res, decoded: false }
  res.on('error', (error) => decoder.destroy(error))
  return { stream: res.pipe(decoder), decoded: true }
}

/** How long an unused pre-opened connection may idle before it is closed. */
export const WARM_SOCKET_TTL_MS = 6_000

export type WarmStats = { opened: number; used: number; discarded: number }
export type PinnedFetch = typeof fetch & {
  /**
   * Opens up to `count` connections (DNS, TCP, TLS) to the origin of `url` WITHOUT sending any request,
   * so a later request to that origin skips the handshake. Each connection is used at most once and is
   * created through the same validating lookup and TLS verification as any other connection.
   */
  warm(url: string | URL, count: number): void
  /** Closes pre-opened connections nobody used. */
  closeWarm(): void
  warmStats(): WarmStats
}

export function createPinnedFetch(options: PinnedFetchOptions = {}): PinnedFetch {
  const lookup = createValidatingLookup(options)
  const allowed = options.isAddressAllowed ?? defaultAllowed
  const maxRedirects = options.maxRedirects ?? 5

  // ---- pre-opened, single-use connections -------------------------------------------------------
  type WarmEntry = { socket: net.Socket; timer: NodeJS.Timeout }
  const warmed = new Map<string, WarmEntry[]>()
  const counters: WarmStats = { opened: 0, used: 0, discarded: 0 }
  const keyOf = (secure: boolean, host: string, port: string | number) => `${secure ? 'https' : 'http'}|${host.toLowerCase()}|${port}`

  function discard(key: string, entry: WarmEntry, destroy: boolean) {
    clearTimeout(entry.timer)
    const list = warmed.get(key)
    const index = list ? list.indexOf(entry) : -1
    if (list && index >= 0) {
      list.splice(index, 1)
      counters.discarded += 1
    }
    if (destroy) entry.socket.destroy()
  }

  function takeWarm(key: string): net.Socket | undefined {
    const list = warmed.get(key)
    while (list && list.length > 0) {
      const entry = list.shift() as WarmEntry
      clearTimeout(entry.timer)
      if (!entry.socket.destroyed) {
        counters.used += 1
        return entry.socket
      }
    }
    return undefined
  }

  // The agent never keeps a socket (keepAlive off), so every request ends with its connection closed.
  // Pre-opened sockets are created with the agent's OWN createConnection, never a hand-built tls.connect:
  // that way the TLS ClientHello is byte-for-byte what a normal request sends. A different handshake
  // (for example an extra ALPN extension) is a different client fingerprint, and some bot protection
  // refuses it.
  const originalCreate = new Map<string, (...args: unknown[]) => net.Socket>()
  const makeAgent = (secure: boolean) => {
    const agent = new (secure ? https : http).Agent({ keepAlive: false })
    const create = (agent as unknown as { createConnection: (...args: unknown[]) => net.Socket }).createConnection.bind(agent)
    originalCreate.set(secure ? 'https' : 'http', create)
    ;(agent as unknown as { createConnection: unknown }).createConnection = (opts: { host?: string; hostname?: string; port?: string | number }, callback: unknown) => {
      const key = keyOf(secure, String(opts.hostname ?? opts.host ?? ''), opts.port ?? (secure ? 443 : 80))
      return takeWarm(key) ?? create(opts, callback)
    }
    return agent
  }
  const agents = { http: makeAgent(false), https: makeAgent(true) }

  function requestOnce(url: URL, init: RequestInit, useWarm = true): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      if (!['http:', 'https:'].includes(url.protocol)) {
        reject(new UnsafeAddressError('Only HTTP(S) URLs are allowed'))
        return
      }
      if (url.username || url.password) {
        reject(new UnsafeAddressError('URLs with embedded credentials are not allowed'))
        return
      }

      const hostname = stripBrackets(url.hostname)
      // IP literals skip the lookup entirely, so they must be validated here.
      if (isIP(hostname) && !allowed(hostname)) {
        reject(new UnsafeAddressError())
        return
      }

      const secure = url.protocol === 'https:'
      const signal = init.signal ?? undefined
      if (signal?.aborted) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        return
      }

      const request = (secure ? https : http).request(
        {
          protocol: url.protocol,
          hostname,
          port: url.port || (secure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: (init.method || 'GET').toUpperCase(),
          headers: { 'Accept-Encoding': 'gzip, deflate, br', ...toHeaders(init.headers) },
          lookup: lookup as never,
          // One connection per request, closed afterwards (keepAlive off): nothing is pooled or reused,
          // except a connection opened by warm() for exactly this origin, used once.
          agent: useWarm ? (secure ? agents.https : agents.http) : false,
          signal,
          ...(secure && options.tls?.ca ? { ca: options.tls.ca } : {}),
        },
        (res) => {
          const status = res.statusCode || 0
          const { stream, decoded } = decodeBody(res)

          const headers = new Headers()
          for (let index = 0; index < res.rawHeaders.length; index += 2) {
            const name = res.rawHeaders[index]
            if (decoded && /^content-(encoding|length)$/i.test(name)) continue
            try {
              headers.append(name, res.rawHeaders[index + 1])
            } catch {
              // ignore header values the Headers class refuses
            }
          }

          if ([101, 204, 205, 304].includes(status) || request.method === 'HEAD') {
            res.resume()
            resolve(new Response(null, { status, statusText: res.statusMessage, headers }))
            return
          }

          // Cancelling the body (size limit reached) must tear down the socket as well.
          stream.on('close', () => {
            res.destroy()
            request.destroy()
          })

          resolve(
            new Response(Readable.toWeb(stream) as ReadableStream, {
              status,
              statusText: res.statusMessage,
              headers,
            })
          )
        }
      )

      request.on('error', reject)
      request.end()
    })
  }

  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    let url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const manual = init.redirect === 'manual'

    for (let hop = 0; ; hop += 1) {
      const usedBefore = counters.used
      let response: Response
      try {
        response = await requestOnce(url, init)
      } catch (error) {
        // A pre-opened connection can be closed by the server while it idled. Retry once on a fresh one.
        const code = (error as { code?: string })?.code
        if (counters.used > usedBefore && ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(String(code)) && (init.method || 'GET').toUpperCase() === 'GET') {
          response = await requestOnce(url, init, false)
        } else {
          throw error
        }
      }
      const location = response.headers.get('location')
      if (manual || ![301, 302, 303, 307, 308].includes(response.status) || !location) return response
      if (hop >= maxRedirects) throw new Error('Too many redirects')
      await response.body?.cancel().catch(() => undefined)
      url = new URL(location, url)
    }
  }) as PinnedFetch

  fetchFn.warm = (input, count) => {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
    const hostname = stripBrackets(url.hostname)
    if (isIP(hostname) && !allowed(hostname)) return

    const secure = url.protocol === 'https:'
    const port = Number(url.port || (secure ? 443 : 80))
    const key = keyOf(secure, hostname, port)

    for (let index = 0; index < Math.min(Math.max(count, 0), 6); index += 1) {
      const socket = (originalCreate.get(secure ? 'https' : 'http') as (...args: unknown[]) => net.Socket)({
        protocol: url.protocol,
        host: hostname,
        hostname,
        port,
        servername: secure && !isIP(hostname) ? hostname : undefined,
        lookup: lookup as never,
        ...(secure && options.tls?.ca ? { ca: options.tls.ca } : {}),
      })
      socket.setNoDelay(true)
      const entry: WarmEntry = { socket, timer: setTimeout(() => discard(key, entry, true), options.warmTtlMs ?? WARM_SOCKET_TTL_MS) }
      entry.timer.unref?.()
      // A failed pre-opened connection is simply dropped; the request then opens a normal one.
      socket.on('error', () => discard(key, entry, true))
      socket.on('close', () => discard(key, entry, false))
      warmed.set(key, [...(warmed.get(key) ?? []), entry])
      counters.opened += 1
    }
  }

  fetchFn.closeWarm = () => {
    for (const [key, list] of warmed) for (const entry of [...list]) discard(key, entry, true)
  }

  fetchFn.warmStats = () => ({ ...counters })

  return fetchFn
}

/** Shared default instance: public addresses only, system DNS, TLS verification on. */
export const pinnedFetch = createPinnedFetch()
