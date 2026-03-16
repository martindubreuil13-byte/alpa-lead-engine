import { SourceLead, SourceSearchInput } from "./types"
import * as cheerio from "cheerio"

export async function searchHotfrog(
  input: SourceSearchInput
): Promise<SourceLead[]> {

  const { query, city, maxResults, send } = input
  const leads: SourceLead[] = []

  const searchQuery = `${query} ${city}`
  const slug = searchQuery.replace(/\s+/g, "-").toLowerCase()

  send?.(`🐸 Hotfrog query: ${searchQuery}`)

  try {

    const url = `https://www.hotfrog.ca/search/${slug}`

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
        "Referer": "https://www.google.com/",
      }
    })

    send?.(`📄 Hotfrog status: ${res.status}`)

    if (!res.ok) return []

    const html = await res.text()

    const $ = cheerio.load(html)

    // Hotfrog layout changes frequently — use flexible selectors
    const listings = $("article, .listing, .search-result")

    send?.(`📡 ${listings.length} Hotfrog raw results`)

    listings.each((_, el) => {

      if (leads.length >= maxResults) return

      const name =
        $(el).find("h3").text().trim() ||
        $(el).find(".listing-title").text().trim()

      const phone =
        $(el).find(".phone").text().trim() ||
        $(el).find(".tel").text().trim() ||
        null

      const website =
        $(el).find("a.website").attr("href") ||
        $(el).find("a[href^='http']").attr("href") ||
        null

      if (!name) return

      leads.push({
        company_name: name,
        phone,
        website,
        email: null,
        industry: query,
        city,
        source: "hotfrog",
        source_url: website
      })
    })

    send?.(`📡 ${leads.length} Hotfrog leads`)

    return leads.slice(0, maxResults)

  } catch (err) {

    send?.("❌ Hotfrog fetch failed")

    return []
  }
}