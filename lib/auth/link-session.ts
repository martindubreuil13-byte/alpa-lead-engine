import { parseCookieHeader, stringFromBase64URL } from '@supabase/ssr'
import type { AuthLink } from './password-reset'

// Evidence from the SDK's verified link exchange, kept only in this page's memory.
// INITIAL_SESSION (a stored login) and unrelated sign-in events never prove a recovery link.
export function createLinkSessionWitness(link: AuthLink, recovery: boolean, hasCodeVerifier = false, recoveryCodeVerifier = false) {
  let token: string | null = null
  // This SDK emits SIGNED_IN for PKCE recovery too; require the saved recovery flow marker in that case.
  const expected = recovery && link.kind !== 'code' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN'
  const codeAllowed = hasCodeVerifier && (!recovery || recoveryCodeVerifier)
  return {
    observe(event: string, session: { access_token?: string } | null) {
      if ((link.kind === 'implicit' || (link.kind === 'code' && codeAllowed)) && event === expected && session?.access_token) token = session.access_token
    },
    tokenFor(candidate: AuthLink) { return JSON.stringify(candidate) === JSON.stringify(link) ? token : null },
  }
}

// Return flow flags only, never the verifier itself. Use the same cookie decoding as the installed SSR client.
export function readLinkVerifier(header: string, name: string) {
  try {
    const cookies = new Map(parseCookieHeader(header).map(cookie => [cookie.name, cookie.value]))
    let encoded = cookies.get(name) ?? ''
    if (!encoded) for (let i = 0; cookies.has(`${name}.${i}`); i++) encoded += cookies.get(`${name}.${i}`)
    const value = JSON.parse(encoded.startsWith('base64-') ? stringFromBase64URL(encoded.slice(7)) : encoded)
    return { present: typeof value === 'string' && value.split('/')[0].length > 0, recovery: typeof value === 'string' && value.endsWith('/PASSWORD_RECOVERY') }
  } catch { return { present: false, recovery: false } }
}

// SDK initialization may clean the URL before React's effect. Hand the original link to its page once only.
export function captureAuthLinkLocation(location?: { pathname: string; search: string; hash: string }) {
  const initial = location && ['/auth/confirm', '/auth/reset'].includes(location.pathname)
    ? { pathname: location.pathname, search: location.search, hash: location.hash } : null
  let pending = initial
  return {
    initial,
    take(pathname: string) {
      if (!pending || pending.pathname !== pathname) return null
      const result = pending
      pending = null
      return result
    },
  }
}
