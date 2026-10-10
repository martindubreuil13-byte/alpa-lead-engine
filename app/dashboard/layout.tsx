import type { Metadata } from 'next'
import { Instrument_Serif } from 'next/font/google'

import DashboardShell from '@/components/dashboard/DashboardShell'

// Display serif, used sparingly by the dashboard (headline and large figures) through
// the existing `font-display` Tailwind slot. Self-hosted by next/font at build time.
const displaySerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className={displaySerif.variable}>
      <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>{children}</DashboardShell>
    </div>
  )
}
