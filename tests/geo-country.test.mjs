import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { googleRegionFor, lookupCountry, resolveCountry } from '../lib/sources/country.ts'

const code = (input) => resolveCountry(input)?.code ?? null

test('a country named in the location is resolved', () => {
  assert.equal(code({ city: 'india' }), 'in')
  assert.equal(code({ city: 'Mumbai, India' }), 'in')
  assert.equal(code({ city: 'London', country: 'United Kingdom' }), 'gb')
  assert.equal(code({ city: 'Dubai, UAE' }), 'ae')
})

test('Canadian provinces and US states resolve only as the trailing region; "CA" is California, not Canada', () => {
  assert.equal(code({ city: 'Ottawa, ON' }), 'ca')
  assert.equal(code({ city: 'Vancouver, British Columbia' }), 'ca')
  assert.equal(code({ city: 'Miami, FL' }), 'us')
  assert.equal(code({ city: 'Austin, TX' }), 'us')
  assert.equal(code({ city: 'Los Angeles, California' }), 'us')
  assert.equal(lookupCountry('ca'), null)
  assert.equal(code({ city: 'Atlanta, Georgia' }), null) // Georgia is also a country: not reliable
})

test('supported Canadian cities keep their country', () => {
  for (const city of ['Montreal', 'Toronto', 'Vancouver', 'Calgary', 'Laval']) assert.equal(code({ city }), 'ca')
})

test('an ambiguous location resolves to nothing instead of a guess; there is no Canada fallback', () => {
  for (const city of ['London', 'Springfield', 'Paris', 'Ottawa', 'Orlando']) assert.equal(code({ city }), null)
  assert.equal(code({ city: 'Springfield', country: '' }), null)
})

test('Google region bias maps only the codes it supports', () => {
  assert.equal(googleRegionFor('gb'), 'uk')
  assert.equal(googleRegionFor('us'), 'us')
  assert.equal(googleRegionFor('in'), undefined)
  assert.equal(googleRegionFor(undefined), undefined)
})

test('Serper gets gl only when the country is known, the coordinate table is kept, and there is no Canada fallback', () => {
  const serper = readFileSync('lib/sources/serper.ts', 'utf8')
  assert.match(serper, /countryCode \? \{ gl: countryCode \} : \{\}/)
  assert.match(serper, /ll: `@\$\{lat\},\$\{lng\},\$\{zoom\}z`,\s*\.\.\.country/)
  assert.match(serper, /toronto: \{ lat: 43\.6532, lng: -79\.3832 \}/)
  assert.ok(!/body\.country \|\| 'Canada'/.test(readFileSync('app/api/scrape/route.ts', 'utf8')))
  const shared = readFileSync('lib/scraper/run-scraper-shared.ts', 'utf8')
  assert.equal((shared.match(/countryCode,/g) ?? []).length >= 3, true) // both Serper calls and the Google call
})

test('a two-letter ending that is also a country code (CA, IN, DE, CO ...) is not read as a state or province', () => {
  for (const city of ['Los Angeles, CA', 'Mumbai, IN', 'Berlin, DE', 'Denver, CO']) assert.equal(code({ city }), null, city)
  assert.equal(code({ city: 'Toronto, CA' }), 'ca') // the supported city still decides
})
