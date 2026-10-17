// The legal pages are published. These checks keep them honest: every page exists and is linked, none is a draft or hidden from search
// engines, all are in the sitemap, the entity details are exactly the owner-supplied ones, no unresolved owner-decision box or invented
// retention period or refund promise is left, and the documented open points are still recorded.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const pages = ['terms', 'privacy', 'refund-policy']
const legal = read('lib/legal.ts')

test('each legal page exists and renders through the shared document', () => {
  for (const page of pages) {
    const source = read(`app/${page}/page.tsx`)
    assert.match(source, /LegalDocument/, page)
    assert.match(source, /legalMetadata\(/, page)
  }
})

test('the legal links are in the shared footer and the plans page', () => {
  for (const page of pages) assert.ok(legal.includes(`'/${page}'`), page)
  assert.match(read('components/site/ResourcesFooter.tsx'), /LegalLinks/)
  const plans = read('app/plans/page.tsx')
  assert.match(plans, /LegalLinks/)
  for (const href of ['/terms', '/privacy', '/refund-policy']) assert.ok(plans.includes(`href="${href}"`), `plans page links ${href}`)
})

test('the pages are published: no draft notice, not hidden from search engines, in the sitemap', () => {
  assert.match(legal, /LEGAL_DRAFT = false/)
  const doc = read('components/legal/LegalDocument.tsx')
  assert.match(doc, /LEGAL_DRAFT \? \{ index: false/, 'noindex applies only while a draft')
  assert.ok(!/OwnerDecision|data-owner-decision/.test(doc), 'the owner-decision box is gone')
  const sitemap = read('app/sitemap.ts')
  for (const page of pages) assert.ok(sitemap.includes(page), `${page} is in the sitemap`)
  for (const page of pages) assert.ok(!/OwnerDecision|Draft for owner review|Owner decision/.test(read(`app/${page}/page.tsx`)), `${page} has no draft marker`)
})

test('the entity and contact details are exactly the owner-supplied ones, shown on every page', () => {
  for (const [needle] of [['MINDRA (AI) Solutions OÜ Ltd'], ['17236155'], ['Ä 50282131'], ['Narva mnt 5, 10117 Tallinn, Estonia'], ['info@mindrasolutions.com']]) {
    assert.ok(legal.includes(needle), needle)
  }
  assert.match(read('components/legal/LegalDocument.tsx'), /LEGAL_ENTITY\.name/)
  for (const page of pages) assert.match(read(`app/${page}/page.tsx`), /LEGAL_ENTITY\.contactEmail/, `${page} gives the contact email`)
  const landing = read('app/page.tsx')
  assert.ok(landing.includes("legalName: 'MINDRA (AI) Solutions OÜ Ltd'") && landing.includes('info@mindrasolutions.com') && landing.includes("streetAddress: 'Narva mnt 5'"), 'structured data matches')
  for (const [name, price] of [['ALPA Starter', '9.99'], ['ALPA Pro', '24.99']]) assert.ok(new RegExp(`name: '${name}',\\s+price: '${price}'`).test(landing), `structured data lists ${name} ${price}`)
})

test('the policies state the approved decisions and make no promise that was not decided', () => {
  const terms = read('app/terms/page.tsx'), privacy = read('app/privacy/page.tsx'), refund = read('app/refund-policy/page.tsx')
  assert.match(terms, /law of Estonia, subject to any mandatory consumer-protection rules/)
  assert.match(terms + refund, /generally non-refundable, except where applicable law requires a refund or MINDRA expressly approves/)
  assert.match(refund, /Paid access continues until the end of the\s+billing period/)
  assert.match(refund, /does not remove or limit any right you have by law, and we do not ask you to waive one/)
  assert.match(privacy, /there is no\s+self-service deletion button/, 'deletion is described as a support request, not a feature')
  assert.match(terms, /Nothing in these terms excludes or limits any liability or right that cannot be excluded or limited by law/)
  assert.ok(!/\b\d+[- ](day|week|month|year)s?\b/i.test(privacy + refund), 'no invented retention or refund period')
  assert.ok(!/money-back|(refund|satisfaction|results) guarantee|guaranteed refund/i.test(terms + privacy + refund), 'no money-back promise')
})

test('pricing is shown as Free 25 lifetime, Starter $9.99 for 100, Pro $24.99 for 500, with no unfinished offer text', () => {
  const plans = read('app/plans/page.tsx')
  for (const needle of ["'25 businesses · lifetime allowance'", "price: '$9.99'", "'100 businesses / month'", "price: '$24.99'", "'500 businesses / month'"]) assert.ok(plans.includes(needle), needle)
  assert.ok(!/Upcoming offer|Not active yet|Stripe coupon/.test(plans))
})

test('the open points that were not decided are still recorded', () => {
  const doc = read('docs/legal-decisions.md')
  for (const topic of ['cookie consent', 'tax', 'unverified', 'standard contractual clauses', 'inactive']) assert.ok(doc.toLowerCase().includes(topic), `docs/legal-decisions.md records: ${topic}`)
})
