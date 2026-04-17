type LeadInput = {
  company_name?: string | null
  website?: string | null
}

export type LeadContext = {
  company_name: string
  website: string
  title: string
  description: string
  h1: string
  enriched: boolean
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function clean(raw: string, max = 200): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return m ? clean(m[1]!) : ''
}

function extractDescription(html: string): string {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
  return m ? clean(m[1]!) : ''
}

function extractH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return m ? clean(m[1]!) : ''
}

// ─── HTTP fetch with timeout ───────────────────────────────────────────────────

async function fetchPage(url: string, timeoutMs = 3000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ALPA/1.0; +https://alpa.ai)' },
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ─── Email extraction ─────────────────────────────────────────────────────────

const EMAIL_EXTRACT_RE = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g

// Exclude role addresses that are never decision-maker inboxes
const JUNK_LOCAL_RE =
  /^(noreply|no-reply|do-not-reply|donotreply|mailer-daemon|postmaster|bounce|unsubscribe|newsletter|news|automated|notifications?|alert|billing|invoice|receipt|legal|privacy|cookie|gdpr|security|abuse|spam|complaints?)$/i

function extractEmailsFromHtml(html: string): string[] {
  const raw = [...html.matchAll(EMAIL_EXTRACT_RE)].map((m) => m[1]!.toLowerCase())
  const unique = [...new Set(raw)]
  return unique.filter((e) => {
    if (e.length > 100) return false
    const local = e.split('@')[0] ?? ''
    return !JUNK_LOCAL_RE.test(local)
  })
}

// ─── Public: find an email by crawling website pages ─────────────────────────

export type FoundEmail = {
  email: string
  source: 'homepage' | 'contact_page' | 'about_page'
}

/**
 * Attempts to find a usable email address for a website.
 * Tries homepage first, then /contact, then /about.
 * Returns null if no valid email found on any page.
 */
export async function findEmailOnWebsite(website: string | null | undefined): Promise<FoundEmail | null> {
  if (!website) return null

  const base = website.replace(/\/$/, '')

  const pages: Array<{ url: string; source: FoundEmail['source'] }> = [
    { url: base, source: 'homepage' },
    { url: `${base}/contact`, source: 'contact_page' },
    { url: `${base}/about`, source: 'about_page' },
  ]

  for (const { url, source } of pages) {
    const html = await fetchPage(url, 2500)
    if (!html) continue

    const emails = extractEmailsFromHtml(html)
    if (emails.length > 0) {
      // Prefer non-generic emails (contact@, info@, hello@ are OK but less ideal)
      const direct = emails.find((e) => {
        const local = e.split('@')[0] ?? ''
        return !/^(info|contact|hello|support|team|enquir|enquiries|sales|marketing|office)$/i.test(local)
      })
      return { email: direct ?? emails[0]!, source }
    }
  }

  return null
}

// ─── Public: enrich lead context from website ────────────────────────────────

export async function enrichLeadContext(lead: LeadInput): Promise<LeadContext> {
  const company_name = String(lead.company_name || '').trim()
  const website = String(lead.website || '').trim()

  const base: LeadContext = { company_name, website, title: '', description: '', h1: '', enriched: false }

  if (!website) return base

  const html = await fetchPage(website, 2000)
  if (!html) return base

  const title = extractTitle(html)
  const description = extractDescription(html)
  const h1 = extractH1(html)

  return {
    company_name,
    website,
    title,
    description,
    h1,
    enriched: Boolean(title || description || h1),
  }
}
