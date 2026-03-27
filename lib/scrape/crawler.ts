import { chromium, type Browser } from "playwright"
import * as cheerio from "cheerio"

import { extractEmail, extractPhone, normalizeUrl, pickTitle } from "./utils"

/* -------------------------------------------------- */
/* TYPES */
/* -------------------------------------------------- */

export type CrawlInput = {
  startUrl: string
  maxPages: number
  listingUrlIncludes?: string | null
  maxLeads: number
  city?: string | null
  source?: string | null
}

export type ScrapedLead = {
  company_name: string
  contact_name?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  industry?: string | null
  city?: string | null
  source?: string | null
  source_url?: string | null
  notes?: string | null
}

/* -------------------------------------------------- */
/* UTILITIES */
/* -------------------------------------------------- */

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>) {

  const browser = await chromium.launch({
    headless: true
  })

  try {
    return await fn(browser)
  } finally {
    await browser.close()
  }
}

/* -------------------------------------------------- */
/* PAGINATION DETECTION */
/* -------------------------------------------------- */

function getNextLink($: cheerio.CheerioAPI, baseUrl: string) {

  const relNext = $("a[rel='next']").attr("href")
  if (relNext) return new URL(relNext, baseUrl).toString()

  const candidate = $("a")
    .filter((_, el) => {

      const text = $(el).text().toLowerCase()

      return (
        text.includes("next") ||
        text.includes("suivant") ||
        text.includes("→") ||
        text === ">"
      )

    })
    .first()
    .attr("href")

  return candidate ? new URL(candidate, baseUrl).toString() : null
}

/* -------------------------------------------------- */
/* COLLECT LISTING LINKS */
/* -------------------------------------------------- */

function collectListingUrls(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  listingUrlIncludes?: string | null
) {

  const urls = new Set<string>()
  const baseHost = new URL(baseUrl).host

  $("a").each((_, el) => {

    const href = $(el).attr("href")
    if (!href) return

    try {

      const url = new URL(href, baseUrl)

      /* stay inside directory domain */

      if (url.host !== baseHost) return

      const path = url.pathname.toLowerCase()

      /* directory pattern filtering */

      if (listingUrlIncludes && !path.includes(listingUrlIncludes)) return

      /* skip garbage pages */

      if (
        path.includes("login") ||
        path.includes("signup") ||
        path.includes("account") ||
        path.includes("privacy") ||
        path.includes("terms") ||
        path.includes("search")
      ) return

      urls.add(url.toString())

    } catch {
      return
    }

  })

  return Array.from(urls)
}

/* -------------------------------------------------- */
/* EMAIL EXTRACTION FROM BUSINESS WEBSITE */
/* -------------------------------------------------- */

async function extractEmailFromWebsite(website: string | null) {

  if (!website) return null

  try {

    const res = await fetch(website, { redirect: "follow" })
    const html = await res.text()

    const $ = cheerio.load(html)

    const bodyText = $("body").text()

    const email =
      extractEmail(bodyText) ??
      $("a[href^='mailto:']").attr("href")?.replace("mailto:", "")

    return email ?? null

  } catch {

    return null

  }
}

/* -------------------------------------------------- */
/* SCRAPE SINGLE BUSINESS PAGE */
/* -------------------------------------------------- */

async function scrapeListing(
  pageUrl: string,
  city?: string | null,
  source?: string | null
): Promise<ScrapedLead> {

  const res = await fetch(pageUrl)

  if (!res.ok) {
    throw new Error("Failed to load listing page")
  }

  const html = await res.text()
  const $ = cheerio.load(html)

  const title =
    pickTitle($("h1").first().text()) ||
    pickTitle($("title").text()) ||
    "Untitled business"

  const bodyText = $("body").text()

  const email =
    extractEmail(bodyText) ??
    $("a[href^='mailto:']").attr("href")?.replace("mailto:", "") ??
    null

  const phone = extractPhone(bodyText) ?? null

  const websiteLink = $("a")
    .filter((_, el) => {

      const text = $(el).text().toLowerCase()

      return (
        text.includes("website") ||
        text.includes("site web") ||
        text.includes("visit") ||
        text.includes("official")
      )

    })
    .first()
    .attr("href")

  const website = normalizeUrl(websiteLink ?? null)

  let enrichedEmail = email

  if (!enrichedEmail && website) {
    enrichedEmail = await extractEmailFromWebsite(website)
  }

  return {

    company_name: title,
    email: enrichedEmail,
    phone,
    website,
    city: city ?? null,
    source: source ?? "directory",
    source_url: pageUrl

  }
}

/* -------------------------------------------------- */
/* MAIN DIRECTORY CRAWLER */
/* -------------------------------------------------- */

export async function crawlDirectory(input: CrawlInput) {

  const listingUrls = new Set<string>()
  const leads: ScrapedLead[] = []

  await withBrowser(async (browser) => {

    const page = await browser.newPage()

    let currentUrl: string | null = input.startUrl
    let pageCount = 0

    while (
      currentUrl &&
      pageCount < input.maxPages &&
      listingUrls.size < input.maxLeads
    ) {

      try {

        await page.goto(currentUrl, {
          waitUntil: "networkidle",
          timeout: 30000
        })

        /* allow dynamic listings to render */

        await page.waitForTimeout(2000)

        const html = await page.content()
        const $ = cheerio.load(html)

        const urls = collectListingUrls(
          $,
          currentUrl,
          input.listingUrlIncludes
        )

        urls.forEach((u) => listingUrls.add(u))

        currentUrl = getNextLink($, currentUrl)

        pageCount++

        await sleep(1000)

      } catch {

        break

      }
    }

  })

  const limitedUrls = Array.from(listingUrls).slice(0, input.maxLeads)

  for (const url of limitedUrls) {

    try {

      const lead = await scrapeListing(
        url,
        input.city,
        input.source
      )

      leads.push(lead)

      await sleep(400)

    } catch {

      continue

    }
  }

  return leads
}
