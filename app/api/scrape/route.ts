import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import { searchGooglePlaces } from '@/lib/sources/google'
import { searchSerperMaps } from '@/lib/sources/serper'
import { validateEmail } from '@/lib/validation'

export const runtime = 'nodejs'

const ENRICHMENT_WORKERS = 2
const FETCH_TIMEOUT = 8000

type ScrapeConfig = {
  query: string
  defaultCity: string
  region: string
  country: string
  maxLeads: number
  userId: string
}

function sanitizeWebsite(url: string | null) {
  if (!url) return null
  return url.startsWith('http') ? url : `https://${url}`
}

function extractEmails(html: string) {
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  return [...new Set((html.match(regex) || []).map((email) => email.toLowerCase()))]
}

async function fetchHtml(url: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function enrichEmail(website: string | null) {
  const base = sanitizeWebsite(website)
  if (!base) return null

  for (const path of ['', '/contact', '/about']) {
    const html = await fetchHtml(base + path)
    if (!html) continue

    const emails = extractEmails(html)
    if (emails.length > 0) return emails[0]
  }

  return null
}

async function saveLead(supabase: ReturnType<typeof createServerClient>, lead: any, userId: string) {
  const { error } = await supabase.from('leads').insert({
    ...lead,
    user_id: userId,
    status: 'inbox',
  })

  return !error
}

async function runScraper(
  supabase: ReturnType<typeof createServerClient>,
  config: ScrapeConfig,
  send: (msg: string) => void
) {
  try {
    const { query, defaultCity, region, maxLeads, userId } = config

    if (!query || !defaultCity || !userId) {
      send('❌ invalid input')
      return
    }

    let discovered = 0
    let enriched = 0

    const seen = new Set<string>()
    const queue: any[] = []

    send('🚀 starting scraper')

    const queries = [
      `${query} ${defaultCity}`,
      `${query} near ${defaultCity}`,
    ]

    const sources = [
      { name: 'Google', fn: searchGooglePlaces },
      { name: 'Serper', fn: searchSerperMaps },
    ]

    for (const currentQuery of queries) {
      if (discovered >= maxLeads) break

      send(`🔎 ${currentQuery}`)

      for (const source of sources) {
        if (discovered >= maxLeads) break

        if (source.name === 'Serper' && discovered > maxLeads * 0.5) {
          continue
        }

        send(`🛰️ ${source.name}`)

        let results: any[] = []

        try {
          results =
            (await source.fn({
              query: currentQuery,
              city: defaultCity,
              region,
              maxResults: maxLeads - discovered,
              send,
            } as any)) || []
        } catch {
          send(`⚠️ ${source.name} failed`)
          continue
        }

        for (const lead of results) {
          if (discovered >= maxLeads) break

          const key = `${lead.company_name}-${lead.website || ''}`
          if (seen.has(key)) continue
          seen.add(key)

          queue.push({
            company_name: lead.company_name,
            website: lead.website,
            phone: lead.phone,
            city: lead.city || defaultCity,
          })

          discovered += 1
          send(`📥 ${lead.company_name}`)
        }
      }
    }

    if (discovered === 0) {
      send('⚠️ no leads found')
    }

    send('🛑 discovery complete')

    async function worker(id: number) {
      while (true) {
        const lead = queue.shift()
        if (!lead) break

        send(`🔬 ${lead.company_name}`)

        const email = await enrichEmail(lead.website)

        if (!email) {
          send(`⛔ no email: ${lead.company_name}`)
          continue
        }

        const saved = await saveLead(
          supabase,
          {
            ...lead,
            email,
            emailData: validateEmail(email, 'website'),
          },
          userId
        )

        if (saved) {
          enriched += 1
          send(`✨ ${lead.company_name}`)
        } else {
          send(`❌ db error: ${lead.company_name}`)
        }
      }

      send(`🧵 worker ${id} done`)
    }

    await Promise.all(
      Array.from({ length: ENRICHMENT_WORKERS }, (_, index) => worker(index + 1))
    )

    send(`📦 discovered: ${discovered}`)
    send(`📦 enriched: ${enriched}`)
    send('🎉 done')
  } catch (err: any) {
    send(`❌ fatal: ${err?.message || 'unknown'}`)
  }
}

export async function POST(req: Request) {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('data: ❌ missing authenticated user\n\n', {
      status: 401,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  const body = await req.json()

  const config: ScrapeConfig = {
    query: String(body.query || '').trim(),
    defaultCity: String(body.defaultCity || '').trim(),
    region: String(body.region || '').trim(),
    country: String(body.country || 'Canada').trim(),
    maxLeads: Number(body.maxLeads || 10),
    userId: user.id,
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: string) => {
        controller.enqueue(encoder.encode(`data: ${msg}\n\n`))
      }

      if (!config.query || !config.defaultCity) {
        send('❌ invalid input')
        controller.close()
        return
      }

      send('🟢 stream started')
      await runScraper(supabase, config, send)
      controller.close()
    },
    cancel() {},
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
