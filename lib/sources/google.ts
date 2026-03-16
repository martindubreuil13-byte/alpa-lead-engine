import { SourceLead, SourceSearchInput } from "./types"

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY!

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchPlaces(
  query: string,
  maxResults: number,
  send?: (msg: string) => void
) {
  const results: any[] = []
  let nextPageToken: string | undefined
  let page = 1

  send?.(`🌍 Google query: ${query}`)

  while (page <= 3 && results.length < maxResults) {
    const params = new URLSearchParams({
      query,
      key: GOOGLE_API_KEY,
    })

    if (nextPageToken) {
      params.append("pagetoken", nextPageToken)
      send?.("⏳ waiting next page token")
      await sleep(2000)
    }

    send?.(`📄 fetching page ${page}`)

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`
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

  const trimmed = results.slice(0, maxResults)

  send?.(`📡 ${trimmed.length} raw results`)

  return trimmed
}

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

function extractCity(components: any[] = []) {
  const locality = components.find(
    (c) => c.types?.includes("locality")
  )

  return locality?.long_name || null
}

export async function searchGooglePlaces(
  input: SourceSearchInput
): Promise<SourceLead[]> {
  const { query, city, maxResults, send } = input

  const leads: SourceLead[] = []
  const seen = new Set<string>()

  const searchQuery = query.trim()

  const places = await fetchPlaces(searchQuery, maxResults, send)

  for (const place of places) {
    if (leads.length >= maxResults) break
    if (!place.place_id) continue
    if (seen.has(place.place_id)) continue

    seen.add(place.place_id)

    send?.(`🔍 processing ${place.name}`)

    const details = await fetchPlaceDetails(place.place_id)

    const company = details?.name || place.name || "Unknown"
    const website = details?.website || null
    const cityName =
      extractCity(details?.address_components || []) || city

    leads.push({
      company_name: company,
      phone: details?.formatted_phone_number || null,
      website,
      email: null,
      industry: details?.types?.[0] || null,
      city: cityName,
      source: "google_places",
      source_url: details?.url || null,
    })
  }

  return leads
}