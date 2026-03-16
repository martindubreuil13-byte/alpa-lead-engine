import { SourceLead, SourceSearchInput } from "./types"
import * as cheerio from "cheerio"

export async function searchBing(
  input: SourceSearchInput
): Promise<SourceLead[]> {

  const { query, city, maxResults, send } = input

  const leads: SourceLead[] = []

  // IMPORTANT: the orchestrator already builds the full query
  const searchQuery = query.trim()

  const url =
    `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&count=10`

  send?.(`🟦 Bing query: ${searchQuery}`)

  try {

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    })

    send?.(`📄 Bing status: ${res.status}`)

    if (!res.ok) return []

    const html = await res.text()

    const $ = cheerio.load(html)

    // Bing sometimes uses multiple result containers
    const results = $("li.b_algo, li.b_ans, .b_algo")

    results.each((i, el) => {

      if (leads.length >= maxResults) return false

      const name =
        $(el).find("h2").text().trim()

      const website =
        $(el).find("h2 a").attr("href") || null

      if (!name || !website) return

      // skip Bing internal redirects
      if (website.includes("bing.com")) return

      send?.(`🔍 processing ${name}`)

      leads.push({
        company_name: name,
        phone: null,
        website,
        email: null,
        industry: searchQuery,
        city,
        source: "bing",
        source_url: website
      })

    })

    send?.(`📡 ${leads.length} Bing leads`)

    return leads

  } catch (err) {

    send?.("❌ Bing fetch failed")

    return []

  }
}