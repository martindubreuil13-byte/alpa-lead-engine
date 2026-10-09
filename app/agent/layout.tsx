import type { Metadata } from 'next'

import { requireAdminPage } from '@/lib/auth/require-admin'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

// Agent Mode is retired for customers: reachable by administrators only (server-side).
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()
  return children
}
