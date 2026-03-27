import { SourceLead, SourceSearchInput } from "./types"

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY!
const GOOGLE_TEXT_SEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json"
const GOOGLE_PLACE_DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json"

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function normalizeGoogleRegion(country?: string) {
  const value = String(country || "").trim().toLowerCase()

  if (!value) return undefined
  if (value === "us" || value.includes("united states")) return "us"
  if (value === "ca" || value.includes("canada")) return "ca"
  if (
    value === "uk" ||
    value === "gb" ||
    value.includes("united kingdom") ||
    value.includes("great britain")
  ) {
    return "uk"
  }
  if (value === "au" || value.includes("australia")) return "au"
  if (value === "ae" || value.includes("united arab emirates") || value.includes("uae")) {
    return "ae"
  }

  return undefined
}

function buildGoogleQueries(
  query: string,
  city: string,
  region?: string,
  country?: string
) {
  const suffix = [city, region, country].filter(Boolean).join(", ")

  return Array.from(
    new Set(
      [
        [query, suffix].filter(Boolean).join(" ").trim(),
        [query, city].filter(Boolean).join(" near ").trim(),
      ].filter(Boolean)
    )
  ).slice(0, 2)
}

async function fetchPlaces(
  query: string,
  maxResults: number,
  country?: string,
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
    const regionBias = normalizeGoogleRegion(country)

    if (regionBias) {
      params.append("region", regionBias)
    }

    if (nextPageToken) {
      params.append("pagetoken", nextPageToken)
      send?.("⏳ waiting next page token")
      await sleep(2000)
    }

    send?.(`📄 fetching page ${page}`)

    const res = await fetch(`${GOOGLE_TEXT_SEARCH_URL}?${params.toString()}`)

    if (!res.ok) {
      send?.(`❌ Google API error: ${res.status}`)
      break
    }

    const data = await res.json()
    const status = String(data?.status || "")

    if (status && status !== "OK" && status !== "ZERO_RESULTS") {
      send?.(`❌ Google API error: ${status}`)
      break
    }

    if (status === "ZERO_RESULTS") {
      send?.('⚠️ No additional results found')
      break
    }

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

  const params = new URLSearchParams({
    place_id: placeId,
    fields,
    key: GOOGLE_API_KEY,
  })

  const res = await fetch(`${GOOGLE_PLACE_DETAILS_URL}?${params.toString()}`)

  if (!res.ok) return null

  const data = await res.json()

  if (data?.status && data.status !== "OK") {
    return null
  }

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
  const { query, city, region, country, maxResults, send } = input

  const leads: SourceLead[] = []
  const seen = new Set<string>()

  if (!GOOGLE_API_KEY) {
    send?.("⚠️ Google Places API key missing")
    return []
  }

  let places: any[] = []

  for (const searchQuery of buildGoogleQueries(query.trim(), city, region, country)) {
    send?.(`🌍 Google query: ${searchQuery}`)

    places = await fetchPlaces(searchQuery, maxResults, country, send)

    if (places.length > 0) {
      break
    }
  }

  const placeBatch = places
    .filter((place) => place?.place_id && !seen.has(place.place_id))
    .slice(0, maxResults)

  placeBatch.forEach((place) => {
    seen.add(place.place_id)
  })

  const detailsBatch = await Promise.all(
    placeBatch.map(async (place) => ({
      place,
      details: await fetchPlaceDetails(place.place_id),
    }))
  )

  if (detailsBatch.length === 0) {
    send?.('⚠️ No additional results found')
  }

  for (const { place, details } of detailsBatch) {
    send?.(`🔍 processing ${place.name}`)

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
