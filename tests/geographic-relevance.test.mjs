import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { isConfirmedOutsideRequestedCountry } from '../lib/scraper/geographic-relevance.ts'
import { parseBusinessAddress } from '../lib/sources/address.ts'
import { resolveCountry } from '../lib/sources/country.ts'

// The same two steps the pipeline performs: the requested country, then the business's own address.
const rejects = (request, address, googleCountry) => {
  const business = googleCountry ? { country: googleCountry } : parseBusinessAddress(address)
  return isConfirmedOutsideRequestedCountry(resolveCountry(request), business)
}

test('a confirmed country mismatch is rejected', () => {
  assert.equal(rejects({ city: 'india' }, '4700 Millenia Blvd, Orlando, FL 32839'), true) // the Orlando result of the India search
  assert.equal(rejects({ city: 'india' }, null, 'Canada'), true) // Google's own address component: Toronto, Vancouver
  assert.equal(rejects({ city: 'Montreal' }, '1 Main St, Albany, NY 12207'), true)
  assert.equal(rejects({ city: 'Mumbai, India' }, '10 High St, London, United Kingdom'), true)
})

test('businesses in the requested country are kept, including other cities of that country', () => {
  assert.equal(rejects({ city: 'india' }, 'B-12, Sector 62, Noida, Uttar Pradesh 201301, India'), false)
  assert.equal(rejects({ city: 'Toronto' }, '200 King St W, Mississauga, ON L5B 1C9, Canada'), false) // a suburb
  assert.equal(rejects({ city: 'Miami, FL' }, '5 Ocean Dr, Fort Lauderdale, FL 33301'), false)
})

test('a missing, partial or ambiguous address is never a reason to reject', () => {
  for (const address of [null, '', 'Main Street', 'Mumbai', 'Plot 5, Sector 62, Uttar Pradesh 201301', '10 Rd, Town, ZZ 12345']) {
    assert.equal(rejects({ city: 'india' }, address), false, String(address))
  }
  assert.equal(rejects({ city: 'india' }, null, null), false)
  assert.equal(rejects({ city: 'india' }, null, 'Czechia'), false) // a country we are not sure about is unknown, not a mismatch
})

test('nothing is filtered when the requested country is unknown, and the search text is never evidence of a business location', () => {
  for (const city of ['London', 'Springfield', 'Miami']) assert.equal(rejects({ city }, '1 Main St, Orlando, FL 32801'), false)
  assert.equal(isConfirmedOutsideRequestedCountry(null, { country: 'India' }), false)
  assert.equal(isConfirmedOutsideRequestedCountry(undefined, {}), false)
})

test('the filter runs on every ingestion path, before merging and saving', () => {
  const shared = readFileSync('lib/scraper/run-scraper-shared.ts', 'utf8')
  assert.equal((shared.match(/if \(!acceptsLocation\(lead\) \|\| !acceptsBusinessType\(lead\)\) continue/g) ?? []).length, 3)
  assert.match(shared, /excluded because their address is in a different country/)
  assert.match(readFileSync('lib/sources/google.ts', 'utf8'), /country: extractCountry\(details\?\.address_components \|\| \[\]\)/)
})
