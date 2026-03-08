import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY!

let isScraping = false
let scrapeConfig: any = null

function streamResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/* ---------------- FETCH PLACES ---------------- */
async function fetchPlaces(
  query: string,
  maxLeads: number,
  send: (msg: string) => void
) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}`

  send('🌍 Contacting Google Places API...')
  const res = await fetch(url)
  const data = await res.json()

  if (!data.results) throw new Error('No results from Google')

  const totalFound = data.results.length
  send(`📡 Google returned ${totalFound} places`)

  // Shuffle so we don't always scrape same businesses
  const shuffled = data.results.sort(() => Math.random() - 0.5)

  const selectedCount = Math.min(maxLeads, shuffled.length)
  send(`🎯 Selecting ${selectedCount} places`)

  return shuffled.slice(0, selectedCount)
}

/* ---------------- FETCH DETAILS ---------------- */
async function fetchPlaceDetails(placeId: string) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,types,address_components&key=${GOOGLE_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()
  return data.result
}

/* ---------------- EMAIL EXTRACTOR ---------------- */
async function extractEmailFromWebsite(website: string | null, send: (msg: string) => void) {
  if (!website) return null

  try {
    send(`🌐 Visiting website for email...`)
    const res = await fetch(website, { redirect: 'follow' })
    const html = await res.text()

    const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    const match = html.match(emailRegex)

    if (match) {
      const email = match[0].toLowerCase()

      if (email.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
        send('⚠️ Ignored fake image email')
        return null
      }

      if (email.includes('example') || email.includes('domain.com')) {
        send('⚠️ Ignored placeholder email')
        return null
      }

      send(`📧 Email found`)
      return email
    }

    send('⚠️ No email found on site')
    return null
  } catch {
    send('⚠️ Could not scan website')
    return null
  }
}

/* ---------------- HELPERS ---------------- */
function extractCity(components: any[]) {
  const comp = components?.find(c => c.types.includes('locality'))
  return comp?.long_name || 'Unknown'
}

function cleanIndustry(types: string[] = []) {
  return types[0]?.replace(/_/g, ' ') || 'business'
}

/* ---------------- MAIN SCRAPER ---------------- */
async function runScraper(send: (msg: string) => void) {
  try {
    const query = scrapeConfig?.query?.trim() || 'businesses'
    const city = scrapeConfig?.defaultCity?.trim()
    const province = scrapeConfig?.region?.trim()
    const country = 'Canada'
    const maxLeads = Number(scrapeConfig?.maxLeads || 20)

    let locationParts: string[] = []
    if (city) locationParts.push(city)
    if (province) locationParts.push(province)
    locationParts.push(country)

    const locationString = locationParts.join(', ')
    const searchString = `${query} in ${locationString}`

    send('🚀 Starting real lead scraping...')
    send(`🔎 Searching for: ${searchString}`)
    send(`📊 Max leads requested: ${maxLeads}`)

    const places = await fetchPlaces(searchString, maxLeads, send)

    let savedCount = 0
    let processed = 0

    for (const place of places) {
      processed++
      send(`🔍 (${processed}/${places.length}) Fetching ${place.name}...`)

      const details = await fetchPlaceDetails(place.place_id)

      const companyName = details.name
      const phone = details.formatted_phone_number || null
      const website = details.website || null
      const industry = cleanIndustry(details.types)
      const cityName = extractCity(details.address_components)

      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('company_name', companyName)
        .maybeSingle()

      if (existing) {
        send(`⚠️ Already exists — skipping`)
        continue
      }

      const email = await extractEmailFromWebsite(website, send)

      const { error } = await supabase.from('leads').insert({
        company_name: companyName,
        industry,
        city: cityName,
        phone,
        website,
        email,
        status: email ? 'ready' : 'needs_enrichment'
      })

      if (error) {
        send(`❌ DB Error`)
      } else {
        savedCount++
        send(`✅ Saved`)
      }
    }

    send(`📦 ${savedCount} enriched leads saved`)
    send('🎉 Scrape complete')
  } catch (err: any) {
    console.error(err)
    send(`❌ Scrape failed`)
  } finally {
    isScraping = false
  }
}

/* ---------- POST = trigger scraper ---------- */
export async function POST(req: Request) {
  if (isScraping) {
    return NextResponse.json({ message: 'Scraper already running' })
  }

  scrapeConfig = await req.json()
  isScraping = true

  return NextResponse.json({ started: true })
}

/* ---------- GET = live log stream ---------- */
export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: string) => {
        controller.enqueue(`data: ${msg}\n\n`)
      }

      if (!isScraping) {
        send('ℹ️ Scraper idle')
        controller.close()
        return
      }

      await runScraper(send)
      controller.close()
    }
  })

  return streamResponse(stream)
}