import type { Metadata } from 'next'

// Account screens are never indexed, and the address of a reset link (it carries a one-time value) is never sent on to another site.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
