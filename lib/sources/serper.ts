import { SourceLead, SourceSearchInput } from "./types"

const SERPER_API_KEY = process.env.SERPER_API_KEY!

type SerperPlace = {
  title?: string
  address?: string
  latitude?: number
  longitude?: number
  rating?: number
  ratingCount?: number
  website?: string
  phoneNumber?: string
  type?: string
  types?: string[]
}

function normalizeZoom(mode?: string) {
  if (mode === "fast") return 13
  if (mode === "deep") return 14
  return 14
}

function buildLatLngFromInput(city: string, region?: string) {
  const key = `${city}`.toLowerCase().trim()

  const map: Record<string, { lat: number; lng: number }> = {
    montreal: { lat: 45.5017, lng: -73.5673 },
    laval: { lat: 45.6066, lng: -73.7124 },
    longueuil: { lat: 45.5312, lng: -73.5181 },
    quebec: { lat: 46.8139, lng: -71.2082 },
    toronto: { lat: 43.6532, lng: -79.3832 },
    vancouver: { lat: 49.2827, lng: -123.1207 },
    calgary: { lat: 51.0447, lng: -114.0719 },
  }

  if (map[key]) return map[key]

  const regionKey = `${city} ${region || ""}`.toLowerCase().trim()

  if (regionKey.includes("montreal")) return { lat: 45.5017, lng: -73.5673 }
  if (regionKey.includes("laval")) return { lat: 45.6066, lng: -73.7124 }
  if (regionKey.includes("longueuil")) return { lat: 45.5312, lng: -73.5181 }
  if (regionKey.includes("quebec")) return { lat: 46.8139, lng: -71.2082 }

  return { lat: 45.5017, lng: -73.5673 }
}

function buildGeoGrid(
  city: string,
  region?: string,
  mode?: string
): Array<{ lat: number; lng: number; zoom: number }> {
  const center = buildLatLngFromInput(city, region)
  const zoom = normalizeZoom(mode)

  const offset =
    mode === "fast" ? 0 :
    mode === "deep" ? 0.03 :
    0.02

  return [
    { lat: center.lat, lng: center.lng, zoom },
    { lat: center.lat + offset, lng: center.lng, zoom },
    { lat: center.lat - offset, lng: center.lng, zoom },
    { lat: center.lat, lng: center.lng + offset, zoom },
    { lat: center.lat, lng: center.lng - offset, zoom },
  ]
}

async function searchOneTile(
  query: string,
  lat: number,
  lng: number,
  zoom: number,
  send?: (msg: string) => void
): Promise<SerperPlace[]> {
  send?.(`🗺️ Serper tile: ${query} @ ${lat.toFixed(4)},${lng.toFixed(4)}`)

  const res = await fetch("https://google.serper.dev/maps", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      ll: `@${lat},${lng},${zoom}z`,
    }),
  })

  if (!res.ok) {
    send?.(`⚠️ Serper maps failed: ${res.status}`)
    return []
  }

  const data = await res.json()
  const places = Array.isArray(data.places) ? data.places : []

  send?.(`📡 Serper raw places: ${places.length}`)

  return places
}

export async function searchSerperMaps(
  input: SourceSearchInput & { mode?: string }
): Promise<SourceLead[]> {
  const { query, city, region, maxResults, send, mode } = input

  const leads: SourceLead[] = []
  const seen = new Set<string>()

  if (!SERPER_API_KEY) {
    send?.("⚠️ Serper API key missing")
    return []
  }

  const grid = buildGeoGrid(city, region, mode)

  send?.(`🔎 Serper query: ${query}`)
  send?.(`🧭 Serper geo tiles: ${grid.length}`)

  for (const tile of grid) {
    if (leads.length >= maxResults) break

    const places = await searchOneTile(
      query,
      tile.lat,
      tile.lng,
      tile.zoom,
      send
    )

    for (const place of places) {
      if (leads.length >= maxResults) break

      const company = String(place.title || "").trim()
      const website = place.website || null
      const phone = place.phoneNumber || null
      const dedupeKey = `${company.toLowerCase()}::${website || ""}::${phone || ""}`

      if (!company) continue
      if (seen.has(dedupeKey)) continue

      seen.add(dedupeKey)

      send?.(`🔍 processing ${company}`)

      leads.push({
        company_name: company,
        phone,
        website,
        email: null,
        industry: place.type || place.types?.[0] || query,
        city,
        source: "serper_maps",
        source_url: website,
      })
    }
  }

  send?.(`📦 Serper final leads: ${leads.length}`)

  return leads
}
