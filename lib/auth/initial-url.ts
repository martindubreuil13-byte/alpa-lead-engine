// The address the visitor arrived on, captured once when the browser first loads this module.
//
// The Supabase browser client reads a one-time code (or an error) from the address by itself as it starts, and then removes it from the
// address. A page that reads the address afterwards sees nothing, and cannot tell a bad link from no link. lib/supabase.ts imports this
// module first, so the original address is saved before the client touches it.

type Captured = { path: string; search: string; hash: string; hasVerifier: boolean }
// The Supabase client keeps the secret it needs to finish an emailed-link sign-in in a cookie of this browser. If it is not there, the
// link was opened somewhere other than where it was asked for, and no code in it can be exchanged.
const holdsVerifier = () => /(?:^|;\s*)sb-[^=]*-code-verifier=/.test(document.cookie)
let captured: Captured | null =
  typeof window === 'undefined' ? null : { path: window.location.pathname, search: window.location.search, hash: window.location.hash, hasVerifier: holdsVerifier() }

/** The address this page was opened on. Used once per page load, and only for the page it was captured on. */
export function takeInitialAuthUrl(): { search: string; hash: string; hasVerifier: boolean } {
  if (typeof window === 'undefined') return { search: '', hash: '', hasVerifier: false }
  const saved = captured
  captured = null
  if (saved && saved.path === window.location.pathname) return { search: saved.search, hash: saved.hash, hasVerifier: saved.hasVerifier }
  return { search: window.location.search, hash: window.location.hash, hasVerifier: holdsVerifier() }
}
