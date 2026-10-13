import { Suspense } from 'react'

import GuestWorkspace from '@/components/guest/GuestWorkspace'

export default function Page() {
  return (
    <Suspense fallback={<p role="status" className="py-16 text-center text-white/70">Loading your businesses…</p>}>
      <GuestWorkspace />
    </Suspense>
  )
}
