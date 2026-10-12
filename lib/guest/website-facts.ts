import { load } from 'cheerio'
export type WebsiteFacts = { title: string | null; description: string | null; headings: string[]; source_urls: string[] }
export function extractWebsiteFacts(html: string, url: string): WebsiteFacts {
 const $ = load(html)
 const clean = (value: string | undefined, max=400) => (value || '').replace(/\s+/g,' ').trim().slice(0,max) || null
 return {
  title: clean($('title').first().text(),200),
  description: clean($('meta[name="description"]').attr('content')),
  headings: [...new Set($('h1,h2').map((_,node)=>clean($(node).text(),150)).get().filter(Boolean))].slice(0,8),
  source_urls: [url],
 }
}
