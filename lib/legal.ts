// The legal pages are published. LEGAL_DRAFT switches the draft notice and the noindex instruction back on, should a page ever need to
// be withdrawn for rework.
export const LEGAL_DRAFT = false

export const LEGAL_UPDATED = '17 October 2026'

// Exactly as supplied by the owner. The registry code and registration number have not been verified against the Estonian Business
// Register (it could not be queried from the build machine); see docs/legal-decisions.md.
export const LEGAL_ENTITY = {
  name: 'MINDRA (AI) Solutions OÜ Ltd',
  registryCode: '17236155',
  registrationNumber: 'Ä 50282131',
  address: 'Narva mnt 5, 10117 Tallinn, Estonia',
  contactEmail: 'info@mindrasolutions.com',
} as const

export const LEGAL_PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund-policy', label: 'Refund & Cancellation' },
] as const
