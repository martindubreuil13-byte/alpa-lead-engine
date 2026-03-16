import { SourceLead, SourceSearchInput } from "./types"

export async function searchOverpass(
  input: SourceSearchInput
): Promise<SourceLead[]> {

  const { query, city, maxResults, send } = input
  const leads: SourceLead[] = []

  send?.(`🧭 Overpass query: ${query} in ${city}`)

  try {

    const overpassQuery = `
      [out:json][timeout:25];
      area["name"="${city}"]->.searchArea;

      (
        node["shop"](area.searchArea);
        node["amenity"](area.searchArea);
        node["office"](area.searchArea);
      );

      out tags;
    `

    const res = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: overpassQuery,
      }
    )

    send?.(`📄 Overpass status: ${res.status}`)

    if (!res.ok) return []

    const data = await res.json()

    for (const el of data.elements) {

      if (leads.length >= maxResults) break

      const tags = el.tags || {}

      if (!tags.name) continue

      leads.push({
        company_name: tags.name,
        phone: tags.phone || null,
        website: tags.website || null,
        email: tags.email || null,
        industry: query,
        city,
        source: "overpass",
        source_url: tags.website || null
      })
    }

    send?.(`📡 ${leads.length} Overpass leads`)

    return leads.slice(0, maxResults)

  } catch (err) {

    send?.("❌ Overpass fetch failed")

    return []
  }
}