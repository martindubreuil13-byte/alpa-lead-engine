/**
 * Contact data sanitiser — strips corrupted prefixes/suffixes from scraped values.
 *
 * Scrapers frequently return fused strings:
 *   "360-3434info@brandvm.com"      ← phone prefix fused with email
 *   "addresshello@domain.comphone"  ← label prefix + phone suffix
 *
 * Both functions return null on rejection, never throw.
 */

// Pull the first valid-looking email out of an arbitrary string
const EMAIL_EXTRACT_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/

const JUNK_EMAIL_RE =
  /^(noreply|no-reply|do-not-reply|donotreply|mailer-daemon|postmaster|info@|admin@|support@|hello@|contact@|webmaster@)/i

// Phone: international or North-American formats, 7–15 digits
const PHONE_EXTRACT_RE =
  /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)/

export function cleanEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const str = raw.trim()

  const match = str.match(EMAIL_EXTRACT_RE)
  if (!match) return null

  const email = match[0].toLowerCase()

  if (email.length > 254) return null
  if (JUNK_EMAIL_RE.test(email)) return null

  const atIdx = email.indexOf('@')
  const local = email.slice(0, atIdx)
  const domain = email.slice(atIdx + 1)

  if (!local || local.length > 64) return null
  if (!domain || !domain.includes('.')) return null

  // Reject suspiciously short TLDs or domains with no label
  const tld = domain.split('.').at(-1) ?? ''
  if (tld.length < 2) return null

  return email
}

export function cleanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const str = raw.trim()
  const match = str.match(PHONE_EXTRACT_RE)
  if (!match) return null
  return match[0]
}
