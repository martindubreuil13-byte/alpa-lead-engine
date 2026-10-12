// Clean company names from search-listing titles, conservatively.
//
// Map and search providers sometimes return a listing title ("Acme - Best Digital Marketing Agency in Mumbai | PPC | SEO
// Company") instead of the company's name. A name is shortened only when it has a clearly separated first part AND the
// rest is unmistakably promotional: a ranking or sales claim that describes a service ("Best ... agency"), or a service
// plus a place ("web developer in India"), or a "#1" claim. Everything else is returned exactly as given: a descriptive
// suffix that is not a claim ("Acme - Digital Marketing Agency"), a partner list ("Smith - Jones LLP"), a brand
// ("Hotel X - Best Western Plus"). Plain rules only, never a model; when in doubt the original name is kept.

// Only spaced separators split a name, so "Coca-Cola" and "AT&T" are never touched.
const SEPARATOR = /\s+(?:-|–|—|\||•|·)\s+|:\s+/

const SERVICE_NOUN =
  '(?:agency|agencies|company|companies|firm|services?|solutions?|consultants?|consulting|consultancy|developers?|designers?|design|development|marketing|seo|experts?|specialists?|studio|freelancers?|provider|professionals?)'

// "Best digital marketing agency", "Top-rated SEO company", "Affordable web design services", "Leading IT firm".
const CLAIM_THEN_SERVICE = new RegExp(`\\b(?:best|top[- ]rated|top[- ]ranked|leading|affordable|cheap(?:est)?|award[- ]winning|no\\.?\\s*1|number\\s+(?:1|one))\\b[^|]*?\\b${SERVICE_NOUN}\\b`, 'i')
// "Web developer in India", "SEO company in Pune", "Marketing agency near Dubai".
const SERVICE_IN_PLACE = new RegExp(`\\b${SERVICE_NOUN}\\s+(?:in|near)\\s+[A-Za-z]`, 'i')
// "#1 ...", "No. 1 ..."
const NUMBER_ONE = /(?:^|\s)(?:#\s?1|no\.?\s*1)\b/i

function isPromotional(text: string): boolean {
  return CLAIM_THEN_SERVICE.test(text) || SERVICE_IN_PLACE.test(text) || NUMBER_ONE.test(text)
}

export function cleanBusinessName(raw: string | null | undefined): string {
  const original = String(raw ?? '')
  const name = original.replace(/\s+/g, ' ').trim()
  if (!name) return original

  const match = SEPARATOR.exec(name)
  if (!match) return name

  const head = name.slice(0, match.index).trim()
  const rest = name.slice(match.index + match[0].length).trim()

  // The part kept must be a plausible name: some letters, not itself a claim or a bare description.
  if (head.length < 2 || !/\p{L}/u.test(head)) return name
  if (isPromotional(head)) return name
  if (!rest || !isPromotional(rest)) return name
  return head
}
