import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { searchGooglePlaces } from "@/lib/sources/google"
import { searchSerperMaps } from "@/lib/sources/serper"
import { SourceLead } from "@/lib/sources/types"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

let isScraping = false
let scrapeConfig: any = null

const ENRICHMENT_WORKERS = 3

type LeadInput = {
  company_name: string
  phone?: string | null
  website?: string | null
  email?: string | null
  industry?: string | null
  city?: string | null
  source?: string | null
  source_url?: string | null
}

function streamResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateSearchQueries(
  business: string,
  city: string,
  region: string,
  country: string
) {
  const base = business.trim()

  const queries = [
    `${base} ${city}`,
    `${base} ${region}`,
    `${base} ${country}`,
    `${base} contractor ${city}`,
    `${base} company ${city}`,
    `${base} services ${city}`,
    `${base} near ${city}`,
  ]

  return [...new Set(queries.filter(Boolean))]
}

function sanitizeWebsite(url: string | null) {
  if (!url) return null

  try {
    const cleaned = url.trim()
    if (!cleaned) return null

    if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
      return cleaned
    }

    return `https://${cleaned}`
  } catch {
    return null
  }
}

function looksLikeAssetEmail(value: string) {
  return /\.(png|jpg|jpeg|webp|svg|gif|avif|ico|css|js|woff|woff2|ttf|eot)/i.test(
    value
  )
}

function isProbablyValidEmail(value: string) {
  const email = value.toLowerCase().trim()

  if (!email.includes("@")) return false
  if (looksLikeAssetEmail(email)) return false
  if (email.includes("/")) return false
  if (email.includes("\\")) return false
  if (email.length > 120) return false

  const blockedFragments = [
    "example.com",
    "domain.com",
    "your@email",
    "email@myemail.com",
  ]

  if (blockedFragments.some((frag) => email.includes(frag))) return false

  return true
}

function scoreEmail(email: string) {
  const lower = email.toLowerCase()

  let score = 0

  if (lower.startsWith("info@")) score += 100
  if (lower.startsWith("contact@")) score += 90
  if (lower.startsWith("hello@")) score += 80
  if (lower.startsWith("sales@")) score += 70
  if (lower.startsWith("office@")) score += 60

  if (lower.startsWith("support@")) score -= 40
  if (lower.startsWith("privacy@")) score -= 50
  if (lower.startsWith("admin@")) score -= 50
  if (lower.includes("noreply")) score -= 100

  return score
}

function extractEmailsFromHtml(html: string) {
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  const matches = html.match(regex) || []

  const unique = [...new Set(matches.map((m) => m.toLowerCase().trim()))]
  const filtered = unique.filter(isProbablyValidEmail)

  return filtered.sort((a, b) => scoreEmail(b) - scoreEmail(a))
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  })

  if (!res.ok) return null

  const contentType = res.headers.get("content-type") || ""
  if (!contentType.includes("text/html")) return null

  return await res.text()
}

async function enrichEmail(
  website: string | null,
  send: (msg: string) => void
) {
  const safeWebsite = sanitizeWebsite(website)
  if (!safeWebsite) return null

  const base = safeWebsite.replace(/\/$/, "")

  const candidateUrls = [
    base,
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/about`,
    `${base}/about-us`,
  ]

  for (const url of candidateUrls) {
    try {
      send(`🌐 scanning ${url}`)

      const html = await fetchHtml(url)
      if (!html) continue

      const emails = extractEmailsFromHtml(html)

      if (emails.length > 0) {
        send(`📧 email found: ${emails[0]}`)
        return emails[0]
      }

      const mailtoMatch = html.match(/mailto:([^"'?\s>]+)/i)
      if (mailtoMatch?.[1]) {
        const mail = mailtoMatch[1].toLowerCase().trim()

        if (isProbablyValidEmail(mail)) {
          send(`📧 mailto found: ${mail}`)
          return mail
        }
      }
    } catch {}
  }

  try {
    const domain = new URL(safeWebsite).hostname.replace("www.", "")
    send("🧠 guessing common email patterns")
    return `info@${domain}`
  } catch {}

  return null
}

async function leadExists(name: string, city: string | null) {
  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("company_name", name)
    .eq("city", city)
    .limit(1)

  return !!(data && data.length > 0)
}

async function saveLead(lead: LeadInput, send: (msg: string) => void) {
  send("🔥 NEW VERSION RUNNING")
const payload = {
  ...lead,
  status: "inbox",
}


  const { error } = await supabase
    .from("leads")
    .insert(payload)

  if (error) {
    send(`❌ db error: ${error.message}`)
    return false
  }

  send("✅ saved")
  return true
}

async function enrichmentWorker(
  workerId: number,
  queue: LeadInput[],
  state: {
    discoveryDone: boolean
    enrichedCount: number
  },
  send: (msg: string) => void
) {
  send(`🧵 enrichment worker ${workerId} ready`)

  while (true) {
    const lead = queue.shift()

    if (!lead) {
      if (state.discoveryDone) {
        send(`🧵 enrichment worker ${workerId} done`)
        return
      }

      await sleep(250)
      continue
    }

    try {
      send(`🔬 enriching: ${lead.company_name}`)

      const email = await enrichEmail(lead.website || null, send)

      if (!email) {
        send(`⛔ rejected: no email found for ${lead.company_name}`)
        continue
      }

      const saved = await saveLead(
        {
          ...lead,
          email,
        },
        send
      )

      if (saved) {
        state.enrichedCount += 1
        send(`✨ enriched lead: ${lead.company_name}`)
        send(`📊 enriched count: ${state.enrichedCount}`)
      }
    } catch {
      send(`⚠️ enrichment error: ${lead.company_name}`)
    }
  }
}

async function runScraper(send: (msg: string) => void) {
  try {
    const query = String(scrapeConfig?.query || "business").trim()
    const city = String(scrapeConfig?.defaultCity || "").trim()
    const region = String(scrapeConfig?.region || "").trim()
    const country = String(scrapeConfig?.country || "Canada").trim()
    const maxLeads = Number(scrapeConfig?.maxLeads || 25)

    send("🚀 starting scraper")

    const searchQueries = generateSearchQueries(query, city, region, country)

    const sources = [
      { name: "Serper", search: searchSerperMaps },
      { name: "Google", search: searchGooglePlaces },
    ]

    const disabledSources = new Set<string>()
    const seenThisRun = new Set<string>()
    const enrichmentQueue: LeadInput[] = []

    let discoveredCount = 0

    const state = {
      discoveryDone: false,
      enrichedCount: 0,
    }

    const workers = Array.from({ length: ENRICHMENT_WORKERS }, (_, i) =>
      enrichmentWorker(i + 1, enrichmentQueue, state, send)
    )

    for (const searchQuery of searchQueries) {
      if (discoveredCount >= maxLeads) break

      send(`🔎 query: ${searchQuery}`)

      for (const source of sources) {
        if (discoveredCount >= maxLeads) break

        if (
          source.name === "Serper" &&
          !process.env.SERPER_API_KEY
        ) {
          continue
        }

        if (
          source.name === "Google" &&
          !process.env.GOOGLE_PLACES_API_KEY
        ) {
          continue
        }

        send(`🛰️ source: ${source.name}`)

        const leads: SourceLead[] = await source.search({
          query: searchQuery,
          city,
          region,
          maxResults: maxLeads - discoveredCount,
          send,
        } as any)

        for (const lead of leads) {
          if (discoveredCount >= maxLeads) break

          const company = String(lead.company_name || "").trim()
          const website = sanitizeWebsite(lead.website || null)
          const cityName = (lead.city || city || "").trim() || null

          if (!company) continue

          const runKey =
            `${company.toLowerCase()}::${website || ""}::${cityName?.toLowerCase() || ""}`

          if (seenThisRun.has(runKey)) continue

          seenThisRun.add(runKey)

          const exists = await leadExists(company, cityName)

          if (exists) continue

          enrichmentQueue.push({
            company_name: company,
            phone: lead.phone || null,
            website,
            email: null,
            industry: lead.industry || null,
            city: cityName,
            source: lead.source || source.name.toLowerCase(),
            source_url: lead.source_url || website,
          })

          discoveredCount++

          send(`📥 discovered lead: ${company}`)
        }
      }
    }

    state.discoveryDone = true
    send("🛑 discovery complete")

    await Promise.all(workers)

    send(`📦 discovered leads: ${discoveredCount}`)
    send(`📦 enriched leads: ${state.enrichedCount}`)
    send("🎉 scrape complete")
  } catch (err: any) {
    send(`❌ scraper error: ${err?.message || "unknown error"}`)
  } finally {
    isScraping = false
  }
}

export async function POST(req: Request) {
  if (isScraping) {
    return NextResponse.json({
      message: "scraper already running",
    })
  }

  scrapeConfig = await req.json()
  isScraping = true

  return NextResponse.json({ started: true })
}

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: string) => {
        controller.enqueue(`data: ${msg}\n\n`)
      }

      if (!isScraping) {
        send("ℹ️ scraper idle")
        controller.close()
        return
      }

      await runScraper(send)

      controller.enqueue(`event: done\ndata: complete\n\n`)
      controller.close()
    },
  })

  return streamResponse(stream)
}