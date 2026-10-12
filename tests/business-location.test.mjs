import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { parseBusinessAddress } from '../lib/sources/address.ts'

const parse = (address) => {
  const { city, region, country } = parseBusinessAddress(address)
  return { city, region, country }
}

test('a US address states its city, state and country', () => {
  assert.deepEqual(parse('4700 Millenia Blvd, Orlando, FL 32839'), { city: 'Orlando', region: 'FL', country: 'United States' })
  assert.deepEqual(parse('123 Main St, Tampa, FL 33602, United States'), { city: 'Tampa', region: 'FL', country: 'United States' })
})

test('a Canadian address states its city, province and country', () => {
  assert.deepEqual(parse('1 Rue Sainte-Catherine, Montréal, QC H2X 1Y4'), { city: 'Montréal', region: 'QC', country: 'Canada' })
  assert.deepEqual(parse('200 King St W, Toronto, ON M5H 3T4, Canada'), { city: 'Toronto', region: 'ON', country: 'Canada' })
})

test('an Indian-style address keeps the region but does not guess the country from a six-digit code', () => {
  assert.deepEqual(parse('Plot 5, Sector 62, Noida, Uttar Pradesh 201301'), { city: 'Noida', region: 'Uttar Pradesh', country: null })
  assert.deepEqual(parse('B-12, Sector 62, Noida, Uttar Pradesh 201301, India'), { city: 'Noida', region: 'Uttar Pradesh', country: 'India' })
})

test('incomplete or ambiguous addresses stay unknown: nothing is invented', () => {
  assert.deepEqual(parse('Mumbai, India'), { city: null, region: null, country: 'India' })
  assert.deepEqual(parse('Main Street'), { city: null, region: null, country: null })
  assert.deepEqual(parse('Plot 5, Sector 62, Uttar Pradesh 201301'), { city: null, region: 'Uttar Pradesh', country: null }) // "Sector 62" is not a city
  assert.deepEqual(parse(''), { city: null, region: null, country: null })
  assert.deepEqual(parse(undefined), { city: null, region: null, country: null })
  assert.equal(parse('10 Main St, Springfield, ZZ 12345').region, null) // not a real state code
  assert.equal(parseBusinessAddress('  12   Rue  X,  Paris ').address, '12 Rue X, Paris') // original kept, whitespace tidied
})

test('a conflicting country is not overridden by the address shape', () => {
  assert.deepEqual(parse('10 Rd, Town, FL 32839, Canada'), { city: null, region: null, country: 'Canada' })
})

test('providers and the pipeline no longer stamp the requested location on a business', () => {
  const serper = readFileSync('lib/sources/serper.ts', 'utf8')
  assert.match(serper, /city: location\.city,/)
  assert.ok(!/^\s+city,\s*$/m.test(serper.split('leads.push')[1] ?? ''))
  assert.match(readFileSync('lib/sources/google.ts', 'utf8'), /extractCity\(details\?\.address_components \|\| \[\]\) \|\| null/)
  const shared = readFileSync('lib/scraper/run-scraper-shared.ts', 'utf8')
  assert.equal((shared.match(/city: lead\.city \|\| defaultCity/g) ?? []).length, 0)
  assert.equal((shared.match(/city: lead\.city \|\| null/g) ?? []).length, 3)
})

test('a bare two-letter ending is never read as a US state: it could be a country code', () => {
  assert.deepEqual(parse('Alexanderplatz 1, Berlin, DE'), { city: null, region: null, country: null })
  assert.deepEqual(parse('12 MG Road, Mumbai, IN'), { city: null, region: null, country: null })
  assert.deepEqual(parse('200 King St W, Toronto, ON, CA'), { city: null, region: null, country: null })
  assert.deepEqual(parse('5 Ocean Dr, Miami, FL'), { city: null, region: null, country: null })
})
