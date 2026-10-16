// The legal pages are drafts until the owner has reviewed and approved them. While LEGAL_DRAFT is true the pages carry a visible
// draft notice, ask search engines not to index them, and stay out of the sitemap. Publishing them is a deliberate change here.
export const LEGAL_DRAFT = true

export const LEGAL_PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund-policy', label: 'Refund & Cancellation' },
] as const
