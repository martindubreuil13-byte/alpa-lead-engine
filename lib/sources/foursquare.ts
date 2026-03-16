import { SourceLead, SourceSearchInput } from "./types"

export async function searchFoursquare(
  input: SourceSearchInput
): Promise<SourceLead[]> {

  const { query, city, maxResults, send } = input
  const leads: SourceLead[] = []

  send?.(`📍 Foursquare query: ${query} ${city}`)

  try {

    const url =
      `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(query)}&near=${encodeURIComponent(city)}&limit=${maxResults}`

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: process.env.FOURSQUARE_API_KEY || ""
      }
    })

    send?.(`📄 Foursquare status: ${res.status}`)

    if (!res.ok) {
      send?.("⚠️ Foursquare request failed")
      return []
    }

    const data = await res.json()

    send?.(`📊 Foursquare results: ${data.results?.length || 0}`)

    if (!data.results) {
      send?.("⚠️ Foursquare returned no results field")
      return []
    }

    for (const place of data.results) {

      if (leads.length >= maxResults) break

      leads.push({
        company_name: place.name || "Unknown",
        phone: place.formatted_phone || place.tel || null,
        website: place.website || place.link || null,
        email: null,
        industry: query,
        city: place.location?.locality || city,
        source: "foursquare",
        source_url: place.website || place.link || null
      })
    }

    send?.(`📡 ${leads.length} Foursquare leads`)

    return leads

  } catch {

    send?.("❌ Foursquare fetch failed")

    return []
  }
}