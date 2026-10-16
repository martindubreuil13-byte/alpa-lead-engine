import { parseAuthLink } from '@/lib/auth/password-reset'
import { createLinkSessionWitness, readLinkVerifier, captureAuthLinkLocation } from '@/lib/auth/link-session'
import { createBrowserClient } from '@supabase/ssr'

// Capture only whether this browser holds the PKCE verifier, before SDK initialization consumes it.
const linkLocation = captureAuthLinkLocation(typeof window !== 'undefined' ? window.location : undefined)
const initialLink = linkLocation.initial
const onAuthLinkPage = Boolean(initialLink)
const verifierName = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]}-auth-token-code-verifier`
let verifier = { present: false, recovery: false }
if (onAuthLinkPage) { try { verifier = readLinkVerifier(document.cookie, verifierName) } catch { /* blocked cookies provide no proof */ } }
const hasCodeVerifier = verifier.present
const linkWitness = createLinkSessionWitness(initialLink
  ? parseAuthLink(initialLink, ['signup', 'email', 'recovery'])
  : { kind: 'none' }, typeof window !== 'undefined' && window.location.pathname === '/auth/reset', hasCodeVerifier, verifier.recovery)

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
// Subscribe before async initialization finishes. INITIAL_SESSION and ordinary stored-login recovery are not link proof.
if (onAuthLinkPage) supabase.auth.onAuthStateChange((event, session) => { linkWitness.observe(event, session) })
export const sessionEstablishedByAuthLink = linkWitness.tokenFor

export const hadAuthLinkCodeVerifier = hasCodeVerifier

export const takeInitialAuthLinkLocation = linkLocation.take
