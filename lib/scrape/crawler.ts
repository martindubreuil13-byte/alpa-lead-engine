import { chromium, type Browser } from "playwright";
import * as cheerio from "cheerio";

import { extractEmail, extractPhone, normalizeUrl, pickTitle } from "./utils";

export type CrawlInput = {
  startUrl: string;
  maxPages: number;
  listingUrlIncludes?: string | null;
  maxLeads: number;
  city?: string | null;
  sourceType?: string | null;
};

export type ScrapedLead = {
  company_name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  industry?: string | null;
  city?: string | null;
  source_type?: string | null;
  source_url?: string | null;
  notes?: string | null;
};

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>) {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

function getNextLink($: cheerio.CheerioAPI, baseUrl: string) {
  const relNext = $("a[rel='next']").attr("href");
  if (relNext) return new URL(relNext, baseUrl).toString();

  const candidate = $("a")
    .filter((_, el) => {
      const text = $(el).text().toLowerCase();
      return text.includes("next") || text.includes("suivant") || text.includes("→");
    })
    .first()
    .attr("href");

  return candidate ? new URL(candidate, baseUrl).toString() : null;
}

function collectListingUrls(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  listingUrlIncludes?: string | null
) {
  const urls = new Set<string>();
  const baseHost = new URL(baseUrl).host;

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, baseUrl);
      if (url.host !== baseHost) return;
      if (listingUrlIncludes && !url.pathname.includes(listingUrlIncludes)) return;
      urls.add(url.toString());
    } catch {
      return;
    }
  });

  return Array.from(urls);
}

async function scrapeListing(pageUrl: string, city?: string | null, sourceType?: string | null) {
  const response = await fetch(pageUrl);
  const html = await response.text();
  const $ = cheerio.load(html);

  const title = pickTitle($("h1").first().text() || $("title").text());
  const bodyText = $("body").text();
  const email = extractEmail(bodyText) ?? $("a[href^='mailto:']").attr("href")?.replace("mailto:", "");
  const phone = extractPhone(bodyText);

  const websiteLink = $("a")
    .filter((_, el) => {
      const text = $(el).text().toLowerCase();
      return text.includes("website") || text.includes("site web") || text.includes("visit");
    })
    .first()
    .attr("href");

  return {
    company_name: title ?? "Untitled business",
    email: email ?? null,
    phone: phone ?? null,
    website: normalizeUrl(websiteLink ?? null),
    city: city ?? null,
    source_type: sourceType ?? "directory",
    source_url: pageUrl
  } satisfies ScrapedLead;
}

export async function crawlDirectory(input: CrawlInput) {
  const listingUrls = new Set<string>();
  const leads: ScrapedLead[] = [];

  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    let currentUrl: string | null = input.startUrl;
    let pageCount = 0;

    while (currentUrl && pageCount < input.maxPages && listingUrls.size < input.maxLeads) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded" });
      const html = await page.content();
      const $ = cheerio.load(html);
      collectListingUrls($, currentUrl, input.listingUrlIncludes).forEach((url) => listingUrls.add(url));
      currentUrl = getNextLink($, currentUrl);
      pageCount += 1;
    }
  });

  const limitedUrls = Array.from(listingUrls).slice(0, input.maxLeads);
  for (const url of limitedUrls) {
    const lead = await scrapeListing(url, input.city, input.sourceType);
    leads.push(lead);
  }

  return leads;
}
