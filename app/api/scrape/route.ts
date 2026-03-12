import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY!

let isScraping = false
let scrapeConfig: any = null

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

/* -------------------------------------------------- */
/* STREAM RESPONSE */
/* -------------------------------------------------- */

function streamResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/* -------------------------------------------------- */
/* SEARCH STRING */
/* -------------------------------------------------- */

function buildSearch(query: string, city: string, region: string) {
  return [query, city, region].filter(Boolean).join(" ").trim()
}

/* -------------------------------------------------- */
/* QUERY VARIANTS */
/* -------------------------------------------------- */

function buildQueryVariants(
  business: string,
  city: string,
  region: string
) {
  const base = buildSearch(business, city, region)

  const variants = new Set<string>([
    base,
    `hair salon ${city} ${region}`,
    `beauty salon ${city} ${region}`,
    `coiffure ${city} ${region}`,
    `hairdresser ${city} ${region}`,
    `barber ${city} ${region}`
  ])

  return Array.from(variants)
}

/* -------------------------------------------------- */
/* GOOGLE SEARCH */
/* -------------------------------------------------- */

async function fetchPlaces(query: string, send: any) {

  const results: any[] = []
  let nextPageToken: string | undefined
  let page = 1

  send(`🌍 Google query: ${query}`)

  while (page <= 3) {

    const params = new URLSearchParams({
      query,
      key: GOOGLE_API_KEY,
    })

    if (nextPageToken) {
      params.append("pagetoken", nextPageToken)
      send("⏳ waiting next page token")
      await sleep(2000)
    }

    send(`📄 fetching page ${page}`)

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`
    )

    if (!res.ok) break

    const data = await res.json()

    if (Array.isArray(data.results)) {
      results.push(...data.results)
    }

    nextPageToken = data.next_page_token
    if (!nextPageToken) break

    page++
  }

  send(`📡 ${results.length} raw results`)
  return results
}

/* -------------------------------------------------- */
/* PLACE DETAILS */
/* -------------------------------------------------- */

async function fetchPlaceDetails(placeId: string) {

  const fields =
    "name,formatted_phone_number,website,types,address_components,url"

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_API_KEY}`

  const res = await fetch(url)

  if (!res.ok) return null

  const data = await res.json()

  return data.result || null
}

/* -------------------------------------------------- */
/* EMAIL EXTRACTION */
/* -------------------------------------------------- */

async function enrichEmail(website: string | null, send: any) {

  if (!website) return null

  try {

    send("🌐 scanning website")

    const res = await fetch(website, { redirect: "follow" })

    const html = await res.text()

    const regex =
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

    const match = html.match(regex)

    if (match) {
      send("📧 email found")
      return match[0]
    }

  } catch {}

  return null
}

/* -------------------------------------------------- */
/* DUPLICATE CHECK */
/* -------------------------------------------------- */

async function leadExists(name: string, city: string | null) {

  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("company_name", name)
    .eq("city", city)
    .limit(1)

  return data && data.length > 0
}

/* -------------------------------------------------- */
/* SAVE LEAD */
/* -------------------------------------------------- */

async function saveLead(lead: LeadInput, send: any) {

  const payload = {
    ...lead,
    status: lead.email ? "ready" : "needs_enrichment"
  }

  const { error } = await supabase.from("leads").insert(payload)

  if (error) {
    send("❌ db error")
    return false
  }

  send("✅ saved")

  return true
}

/* -------------------------------------------------- */
/* CITY */
/* -------------------------------------------------- */

function extractCity(components: any[] = []) {

  const locality = components.find(
    (c) => c.types?.includes("locality")
  )

  return locality?.long_name || null
}

/* -------------------------------------------------- */
/* MAIN SCRAPER */
/* -------------------------------------------------- */

async function runScraper(send: any) {

  try {

    const query = scrapeConfig?.query || "business"
    const city = scrapeConfig?.defaultCity || ""
    const region = scrapeConfig?.region || ""
    const maxLeads = Number(scrapeConfig?.maxLeads || 25)

    send("🚀 starting scraper")

    const variants = buildQueryVariants(query, city, region)

    send(`🧠 query variants: ${variants.length}`)

    const seen = new Set<string>()

    let collected = 0
    let processed = 0

    for (const variant of variants) {

      if (collected >= maxLeads) break

      const places = await fetchPlaces(variant, send)

      for (const place of places) {

        if (collected >= maxLeads) break
        if (!place.place_id) continue
        if (seen.has(place.place_id)) continue

        seen.add(place.place_id)

        processed++

        send(`🔍 processing ${place.name}`)

        const details = await fetchPlaceDetails(place.place_id)

        const company =
          details?.name || place.name || "Unknown"

        const website = details?.website || null

        const cityName =
          extractCity(details?.address_components || []) || city

        /* -------- DUPLICATE CHECK FIRST -------- */

        const exists = await leadExists(company, cityName)

        if (exists) {
          send("⚠️ already exists")
          continue
        }

        /* -------- EMAIL ENRICHMENT -------- */

        const email = await enrichEmail(website, send)

        /* -------- SAVE -------- */

        const saved = await saveLead({
          company_name: company,
          phone: details?.formatted_phone_number || null,
          website,
          email,
          industry: details?.types?.[0] || null,
          city: cityName,
          source: "google_places",
          source_url: details?.url || null,
        }, send)

        if (saved) collected++

      }

    }

    send(`📦 ${collected} leads saved`)
    send("🎉 scrape complete")

  } catch (err) {

    send("❌ scraper error")

  } finally {

    isScraping = false
  }
}

/* -------------------------------------------------- */
/* POST START */
/* -------------------------------------------------- */

export async function POST(req: Request) {

  if (isScraping) {
    return NextResponse.json({ message: "scraper already running" })
  }

  scrapeConfig = await req.json()

  isScraping = true

  return NextResponse.json({ started: true })
}

/* -------------------------------------------------- */
/* STREAM */
/* -------------------------------------------------- */

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