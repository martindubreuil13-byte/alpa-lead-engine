import test from 'node:test'
import assert from 'node:assert/strict'

import { isLowPriorityRole, pickBestEmailCandidateV2 } from '../lib/scraper/email-intelligence.ts'

const candidate = (value, over = {}) => {
  const local = value.split('@')[0]
  const generic = ['info', 'contact', 'hello', 'admin', 'support', 'sales', 'office'].includes(local)
  return {
    value, emailSource: 'https://acme.com/contact', emailConfidence: generic ? 'medium' : 'high', isGenericEmail: generic,
    domainMatch: true, evidence: 'mailto', relevance: 'business-domain', ...over,
  }
}
const pick = (...values) => pickBestEmailCandidateV2(values.map((v) => (typeof v === 'string' ? candidate(v) : v)))?.value ?? null

test('careers@ no longer beats a commercial address on the same domain (it used to, as a non-generic "high")', () => {
  assert.equal(pick('careers@acme.com', 'info@acme.com'), 'info@acme.com')
  assert.equal(pick('jobs@acme.com', 'sales@acme.com', 'support@acme.com'), 'sales@acme.com')
  assert.equal(pick('recruitment@acme.com', 'hello@acme.com'), 'hello@acme.com')
  assert.equal(pick('support@acme.com', 'contact@acme.com'), 'contact@acme.com')
  assert.equal(pick('hr@acme.com', 'billing@acme.com', 'contact@acme.com'), 'contact@acme.com')
})

test('a legitimate personal business address is preserved, and still wins as before', () => {
  assert.equal(pick('careers@acme.com', 'priya.shah@acme.com', 'info@acme.com'), 'priya.shah@acme.com')
  assert.equal(pick('priya@acme.com', 'info@acme.com'), 'priya@acme.com')
})

test('a low-priority address is kept when it is the only one, and never replaces a closer-tied one', () => {
  assert.equal(pick('careers@3mindsdigital.com'), 'careers@3mindsdigital.com')
  assert.equal(pick('support@acme.com', 'jobs@acme.com'), 'jobs@acme.com') // deterministic among low-priority: the existing order
  // a business-domain careers address is not displaced by a mailbox on an unrelated provider
  assert.equal(pick('careers@acme.com', candidate('owner@gmail.com', { relevance: 'external-provider', domainMatch: false, emailConfidence: 'medium' })), 'careers@acme.com')
})

test('it is deterministic and never invents an address', () => {
  const inputs = ['careers@acme.com', 'info@acme.com', 'sales@acme.com', 'support@acme.com']
  const forward = pick(...inputs)
  const backward = pick(...[...inputs].reverse())
  assert.equal(forward, backward)
  assert.ok(inputs.includes(forward))
  assert.equal(pickBestEmailCandidateV2([]), null)
})

test('the low-priority list is role-based only: it never matches personal or commercial addresses', () => {
  for (const email of ['careers@x.com', 'jobs@x.com', 'support@x.com', 'recruitment@x.com', 'billing@x.com']) assert.equal(isLowPriorityRole(email), true, email)
  for (const email of ['info@x.com', 'sales@x.com', 'hello@x.com', 'contact@x.com', 'priya@x.com', 'john.careers@x.com']) assert.equal(isLowPriorityRole(email), false, email)
})

import { readFileSync } from 'node:fs'
import { countsAsStrongEmail } from '../lib/scraper/email-intelligence.ts'

const full = (...values) => pickBestEmailCandidateV2(values.map((v) => (typeof v === 'string' ? candidate(v) : v)))

test('replacing a high-confidence same-domain careers@ with info@ keeps its own confidence and earns strong credit for the fallback decision only', () => {
  const picked = full('careers@acme.com', 'info@acme.com')
  assert.equal(picked.value, 'info@acme.com')
  assert.equal(picked.emailConfidence, 'medium') // never relabelled
  assert.equal(picked.fallbackStrong, true)
  assert.equal(countsAsStrongEmail({ email: picked.value, email_confidence: picked.emailConfidence, email_strong_for_fallback: picked.fallbackStrong }), true)
})

test('no credit when nothing strong was replaced, so a thin result still triggers the fallback', () => {
  assert.equal(full('info@acme.com', 'sales@acme.com').fallbackStrong, undefined) // no swap at all
  assert.equal(full('careers@acme.com').fallbackStrong, undefined) // nothing to swap to
  // the replaced address was only medium confidence: nothing strong was lost
  const mediumCareers = candidate('careers@acme.com', { emailConfidence: 'medium' })
  assert.equal(full(mediumCareers, 'info@acme.com').fallbackStrong, undefined)
  // the replaced address was not on the business's own domain
  const associated = candidate('careers@acme.ca', { relevance: 'associated', domainMatch: false })
  assert.equal(full(associated, candidate('info@acme.ca', { relevance: 'associated', domainMatch: false })).fallbackStrong, undefined)
  // a medium address alone is not strong, with or without the flag missing
  assert.equal(countsAsStrongEmail({ email: 'info@acme.com', email_confidence: 'medium' }), false)
  assert.equal(countsAsStrongEmail({ email: null, email_confidence: null, email_strong_for_fallback: true }), false)
  assert.equal(countsAsStrongEmail({ email: 'a@b.com', email_confidence: 'high' }), true)
})

test('the credit feeds both the strong-signal count and the Google budget sizing, and is carried through merges', () => {
  const shared = readFileSync('lib/scraper/run-scraper-shared.ts', 'utf8')
  assert.match(shared, /leads\.filter\(countsAsStrongEmail\)\.length/)
  assert.match(shared, /!lead\.email \|\| !countsAsStrongEmail\(lead\)/)
  assert.match(shared, /lead\.email_strong_for_fallback = 'fallbackStrong' in emailRecord && emailRecord\.fallbackStrong === true/)
  assert.match(shared, /email_strong_for_fallback: websiteChanged \? false : existing\.email_strong_for_fallback/)
  assert.ok(!/email_confidence === 'high'/.test(shared.replace(/upserted\.previousLead\.email_confidence === 'low'/g, ''))) // no raw high-only checks remain
})
