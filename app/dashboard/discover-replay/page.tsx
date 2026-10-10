import { notFound } from 'next/navigation'

import ReplayStudio from '@/components/scraper/ReplayStudio'

// Local development only. In any other environment, including production and preview
// deployments, this route behaves as if it does not exist.
export const dynamic = 'force-dynamic'

export default function DiscoverReplayPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return <ReplayStudio />
}
