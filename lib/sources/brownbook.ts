import { SourceLead, SourceSearchInput } from "./types"
import * as cheerio from "cheerio"

export async function searchBrownbook(
  input: SourceSearchInput
): Promise<SourceLead[]> {

  const { query, city, maxResults, send } = input
  const leads: SourceLead[] = []

  send?.(`📘 Brownbook query: ${query} ${city}`)

  try {

    const url = `https://www.brownbook.net/search/?what=${encodeURIComponent(query)}&where=${encodeURIComponent(city)}`

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
        "Accept": "text/html"
      }
    })

    send?.(`📄 Brownbook status: ${res.status}`)

    if (!res.ok) return []

    const html = await res.text()

    const $ = cheerio.load(html)

    $(".business").each((_, el) => {

      if (leads.length >= maxResults) return

      const name = $(el).find(".business-name").text().trim()
      const phone = $(el).find(".telephone").text().trim() || null
      const website = $(el).find("a.website").attr("href") || null

      if (!name) return

      leads.push({
        company_name: name,
        phone,
        website,
        email: null,
        industry: query,
        city,
        source: "brownbook",
        source_url: website
      })
    })

    send?.(`📡 ${leads.length} Brownbook leads`)

    return leads.slice(0, maxResults)

  } catch {

    send?.("❌ Brownbook fetch failed")

    return []
  }
}