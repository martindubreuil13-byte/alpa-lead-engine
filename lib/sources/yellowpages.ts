import { SourceLead, SourceSearchInput } from "./types"
import * as cheerio from "cheerio"

export async function searchYellowPages(
  input: SourceSearchInput
): Promise<SourceLead[]> {

  const { query, city, maxResults, send } = input

  const leads: SourceLead[] = []

  const searchQuery = query.trim()

  const url =
    `https://www.yellowpages.ca/search/si/1/${encodeURIComponent(searchQuery)}/${encodeURIComponent(city)}`

  send?.(`📒 YellowPages query: ${searchQuery}`)

  try {

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":
          "en-CA,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    })

    send?.(`📄 YellowPages status: ${res.status}`)

    if (!res.ok) return []

    const html = await res.text()

    const $ = cheerio.load(html)

    // YellowPages listings container
    $(".result").each((i, el) => {

      if (leads.length >= maxResults) return false

      const name =
        $(el).find(".business-name").text().trim()

      if (!name) return

      const phone =
        $(el).find(".phones").text().trim() || null

      const website =
        $(el).find(".track-visit-website").attr("href") || null

      send?.(`🔍 processing ${name}`)

      leads.push({
        company_name: name,
        phone,
        website,
        email: null,
        industry: searchQuery,
        city,
        source: "yellowpages",
        source_url: url
      })
    })

    send?.(`📡 ${leads.length} YellowPages leads`)

    return leads

  } catch (err) {

    send?.("❌ YellowPages fetch failed")
    return []

  }
}