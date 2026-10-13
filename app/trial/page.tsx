import { Suspense } from 'react'

import TrialExperience from '@/components/trial/TrialExperience'

export default function TrialPage() {
  return (
    <Suspense fallback={<p role="status" className="py-16 text-center text-white/70">Preparing your free search…</p>}>
      <TrialExperience />
    </Suspense>
  )
}
