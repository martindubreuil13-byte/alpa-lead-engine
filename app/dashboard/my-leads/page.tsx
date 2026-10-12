import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import MyLeadsWorkspace from '@/components/my-leads/MyLeadsWorkspace'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const dynamic = 'force-dynamic'

// My Leads is the permanent business repository (ADR-001). This page only checks the session: the workspace loads one lightweight,
// session-scoped page of businesses at a time from /api/my-leads and opens a full business only on demand. It no longer reads the
// whole library, and it never starts research.
export default async function MyLeadsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return (
    <Suspense fallback={null}>
      <MyLeadsWorkspace />
    </Suspense>
  )
}
