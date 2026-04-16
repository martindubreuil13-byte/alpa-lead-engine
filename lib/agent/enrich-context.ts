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

function clean(raw: string, max = 200): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return m ? clean(m[1]) : ''
}

function extractDescription(html: string): string {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
  return m ? clean(m[1]) : ''
}

function extractH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return m ? clean(m[1]) : ''
}

export async function enrichLeadContext(lead: LeadInput): Promise<LeadContext> {
  const company_name = String(lead.company_name || '').trim()
  const website = String(lead.website || '').trim()

  const base: LeadContext = { company_name, website, title: '', description: '', h1: '', enriched: false }

  if (!website) return base

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(website, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ALPA/1.0)' },
    }).finally(() => clearTimeout(timer))

    if (!response.ok) return base

    const html = await response.text()

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
  } catch {
    console.log('[enrich-context] fetch failed for', website)
    return base
  }
}
