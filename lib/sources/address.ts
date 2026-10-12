// What a provider's address line actually says about where a business is.
//
// Only what the address itself states is returned. A part is called a city, region or country only when the address
// format makes that reliable (a trailing country, "FL 32801", "QC H2X 1Y4", a postal code after a region name); anything
// else stays null. The requested search location is never used here: a missing value means "not known".

import { CA_REGIONS, US_REGIONS, lookupCountry, normalize } from './country.ts'

export type BusinessLocation = {
  /** The provider's address, trimmed, exactly as given. */
  address: string | null
  city: string | null
  region: string | null
  country: string | null
}

const US_TAIL = /^([A-Za-z]{2})\s+\d{5}(?:-\d{4})?$/
const CA_TAIL = /^([A-Za-z]{2})\s+[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/
// A region NAME (three or more characters) before a postal code. Two-letter codes are handled above, only when real.
const NAME_AND_POSTAL = /^([^\d]{3,}?)\s+\d{4,6}$/

export function parseBusinessAddress(raw: string | null | undefined): BusinessLocation {
  const address = String(raw ?? '').replace(/\s+/g, ' ').trim() || null
  const empty: BusinessLocation = { address, city: null, region: null, country: null }
  if (!address) return empty

  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  let country: string | null = null
  const named = lookupCountry(parts[parts.length - 1])
  if (named && parts.length > 1) {
    country = named.name
    parts.pop()
  }

  const tail = parts[parts.length - 1] ?? ''
  let region: string | null = null
  // A bare two-letter ending ("…, DE", "…, IN", "…, CA") is not read as a state: it is as likely a country code.
  const us = US_TAIL.exec(tail)
  const ca = CA_TAIL.exec(tail)
  if (us && US_REGIONS.has(us[1].toLowerCase()) && (country === null || country === 'United States')) {
    region = us[1].toUpperCase()
    country = 'United States'
  } else if (ca && CA_REGIONS.has(ca[1].toLowerCase()) && (country === null || country === 'Canada')) {
    region = ca[1].toUpperCase()
    country = 'Canada'
  } else if (NAME_AND_POSTAL.test(tail)) {
    // "Uttar Pradesh 201301": a region name before a postal code. The country is not inferred from the code's shape.
    region = NAME_AND_POSTAL.exec(tail)![1].trim()
  }

  let city: string | null = null
  if (region !== null) {
    const candidate = parts[parts.length - 2] ?? null
    // A city has no digits (a street, suite or sector does) and is not the region repeated.
    if (candidate && !/\d/.test(candidate) && candidate.length <= 60 && normalize(candidate) !== normalize(region)) city = candidate
  }
  return { address, city, region, country }
}
