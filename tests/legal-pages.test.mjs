// The legal pages are drafts that need owner approval. These checks keep them honest: every page exists and is linked, drafts stay out
// of search engines and the sitemap, and every decision flagged on a page is listed in the owner-decision document (and vice versa).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const pages = ['terms', 'privacy', 'refund-policy']
const draft = /LEGAL_DRAFT = true/.test(read('lib/legal.ts'))

test('each legal page exists and renders through the shared document', () => {
  for (const page of pages) {
    const source = read(`app/${page}/page.tsx`)
    assert.match(source, /LegalDocument/, page)
    assert.match(source, /legalMetadata\(/, page)
  }
})

test('the legal links are in the shared footer and the plans page', () => {
  const links = read('lib/legal.ts')
  for (const page of pages) assert.ok(links.includes(`'/${page}'`), page)
  assert.match(read('components/site/ResourcesFooter.tsx'), /LegalLinks/)
  assert.match(read('app/plans/page.tsx'), /LegalLinks/)
})

test('while the pages are drafts they are not indexed and not in the sitemap', () => {
  if (!draft) return
  assert.match(read('components/legal/LegalDocument.tsx'), /index: false/)
  const sitemap = read('app/sitemap.ts')
  for (const page of pages) assert.ok(!sitemap.includes(`/${page}`), `${page} must not be in the sitemap while a draft`)
})

test('every flagged owner decision is documented, and every documented one is flagged', () => {
  const flagged = pages.flatMap((p) => [...read(`app/${p}/page.tsx`).matchAll(/<OwnerDecision id="([A-Z]\d+)"/g)].map((m) => m[1]))
  const documented = [...read('docs/legal-owner-decisions.md').matchAll(/^- \*\*([A-Z]\d+)\*\*/gm)].map((m) => m[1])
  assert.equal(new Set(flagged).size, flagged.length, 'decision ids are unique')
  assert.deepEqual([...flagged].sort(), [...documented].sort())
  assert.ok(flagged.length >= 20)
})

test('the pages do not invent an address, entity or refund commitment', () => {
  for (const page of pages) {
    const text = read(`app/${page}/page.tsx`)
    assert.ok(!/\b\d{2,5}\s+[A-Z][a-z]+\s+(Street|St\.|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b/.test(text), `${page}: street address`)
    assert.ok(!/\b(Inc\.|Ltd\.|LLC|Corp\.|S\.E\.N\.C|Inc\b)/.test(text), `${page}: legal entity`)
    assert.ok(!/\b\d+[- ]day (money-back|refund)/i.test(text), `${page}: refund period`)
  }
})
