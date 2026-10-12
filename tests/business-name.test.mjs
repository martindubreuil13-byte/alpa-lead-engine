import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { cleanBusinessName } from '../lib/sources/business-name.ts'

test('clearly promotional listing tails are removed', () => {
  const cases = [
    ['Digital Corsel - Best Digital Marketing Agency in Mumbai | PPC | SEO Company', 'Digital Corsel'],
    ['iRoid Solutions - Best IT company in India | Android & iOS App Development', 'iRoid Solutions'],
    ['Ashish Ajani - Freelance Web Developer in India', 'Ashish Ajani'],
    ['Acme Digital | Top-Rated SEO Company', 'Acme Digital'],
    ['Pixel Forge – Affordable Web Design Services', 'Pixel Forge'],
    ['Zenith Media — #1 Marketing Agency', 'Zenith Media'],
    ['Brightside: Leading digital marketing company in Pune', 'Brightside'],
  ]
  for (const [before, after] of cases) assert.equal(cleanBusinessName(before), after, before)
})

test('legitimate names are never changed', () => {
  const names = [
    'Digital Corsel', 'Coca-Cola', 'AT&T', 'Smith - Jones LLP', 'Hotel Ritz - Best Western Plus', 'Best Buy', 'Top Gun Aviation',
    'Invoidea - Mobile App & Software Development Company India', // descriptive but not a claim: kept
    'Acme - Digital Marketing Agency', 'Orangemantra - AI Digital Transformation Company', 'WPWeb Infotech', 'Duogeeks Web Design Orlando',
    'Leading Edge Consulting', 'The Best Marketing Agency', 'Top Dog Pet Grooming - Best Friends Welcome',
  ]
  for (const name of names) assert.equal(cleanBusinessName(name), name, name)
})

test('when the kept part would not be a name, or the claim is in front, the original is kept', () => {
  assert.equal(cleanBusinessName('Best SEO Company in Mumbai - Acme'), 'Best SEO Company in Mumbai - Acme')
  assert.equal(cleanBusinessName('A - Best Marketing Agency in Pune'), 'A - Best Marketing Agency in Pune') // one character: not a plausible name
  assert.equal(cleanBusinessName('123 - Best Marketing Agency in Pune'), '123 - Best Marketing Agency in Pune')
  assert.equal(cleanBusinessName('Best Agency in Pune | Best Agency in Pune'), 'Best Agency in Pune | Best Agency in Pune')
})

test('empty and odd input is returned safely; whitespace is tidied', () => {
  assert.equal(cleanBusinessName(''), '')
  assert.equal(cleanBusinessName(null), '')
  assert.equal(cleanBusinessName(undefined), '')
  assert.equal(cleanBusinessName('  Acme   Corp  '), 'Acme Corp')
})

test('it is applied once, where every provider result becomes a discovery lead', () => {
  const shared = readFileSync('lib/scraper/run-scraper-shared.ts', 'utf8')
  assert.match(shared, /company_name: cleanBusinessName\(lead\.company_name\),/)
  assert.equal((shared.match(/cleanBusinessName\(/g) ?? []).length, 1)
})
