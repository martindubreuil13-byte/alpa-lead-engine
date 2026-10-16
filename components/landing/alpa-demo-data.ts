// The sample the landing-page demonstration plays. Every business here is fictional: names, addresses, phone numbers (the reserved
// 555-01xx range) and websites (the reserved .example domain) are invented, and the demonstration says so on screen. One business has no
// public email on purpose: ALPA shows contact details only when a business publishes them.

export type DemoBusiness = {
  name: string
  area: string
  kind: string
  website: string
  phone: string
  /** null: the business does not publish an email, which the demonstration shows rather than hides. */
  email: string | null
}

export const DEMO_SEARCH = { industry: 'Architects', location: 'Toronto', count: 25 } as const

export const DEMO_BUSINESSES: readonly DemoBusiness[] = [
  { name: 'Halden & Roe Architects', area: 'The Annex', kind: 'Residential · Heritage', website: 'haldenroe.example', phone: '(416) 555-0131', email: 'studio@haldenroe.example' },
  { name: 'Northline Studio', area: 'Liberty Village', kind: 'Commercial interiors', website: 'northline.example', phone: '(416) 555-0148', email: null },
  { name: 'Verrier Associates', area: 'Yorkville', kind: 'Residential', website: 'verrier.example', phone: '(416) 555-0162', email: 'hello@verrier.example' },
  { name: 'Atelier Kessler', area: 'Leslieville', kind: 'Design-build', website: 'kessler.example', phone: '(647) 555-0107', email: 'office@kessler.example' },
  { name: 'Marrow Lane Architecture', area: 'Distillery District', kind: 'Mixed-use · Hospitality', website: 'marrowlane.example', phone: '(416) 555-0176', email: 'info@marrowlane.example' },
  { name: 'Piper & Vale', area: 'Riverdale', kind: 'Residential additions', website: 'pipervale.example', phone: '(647) 555-0120', email: 'hello@pipervale.example' },
  { name: 'Lumen Form Architects', area: 'Midtown', kind: 'Education · Institutional', website: 'lumenform.example', phone: '(416) 555-0189', email: 'contact@lumenform.example' },
]

/** The business the enrichment and the AI profile are shown for. */
export const DEMO_FEATURED = {
  ...DEMO_BUSINESSES[0],
  description: 'Boutique studio working on heritage restoration and custom homes across central Toronto.',
  profile: {
    summary:
      'A small Toronto architecture studio focused on heritage restoration and custom residential work. Its website highlights adaptive reuse of Victorian homes and a close, collaborative process with owners.',
    mentions: ['Heritage restoration', 'Custom homes', 'Owner collaboration'],
    tags: ['Residential', 'Heritage', 'Boutique studio'],
  },
} as const

export const DEMO_STAGES = [
  { id: 'discover', label: 'Discover', short: '01', ms: 7600 },
  { id: 'enrich', label: 'Enrich', short: '02', ms: 8000 },
  { id: 'intelligence', label: 'AI Intelligence', short: '03', ms: 8800 },
] as const

/** A description for people who cannot see the animation. */
export const DEMO_TEXT_ALTERNATIVE =
  'A demonstration with sample, fictional businesses. Step one, Discover: a search for architects in Toronto finds 25 businesses. ' +
  'Step two, Enrich: for each business ALPA gathers the website, phone number, email when the business publishes one, and a short description. ' +
  'Step three, AI Intelligence: ALPA turns the information a business publishes into a concise profile of who it is and what it does.'

/** Fixed positions for the discovery map (a seeded sequence, so the server and the browser draw the same dots). */
export function demoMapDots(count: number): { x: number; y: number }[] {
  let seed = 7
  const next = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 }
  const dots: { x: number; y: number }[] = []
  while (dots.length < count) {
    const x = 28 + next() * 344
    const y = 26 + next() * 190
    if (dots.every((d) => Math.hypot(d.x - x, d.y - y) > 30)) dots.push({ x: Math.round(x), y: Math.round(y) })
  }
  return dots
}
