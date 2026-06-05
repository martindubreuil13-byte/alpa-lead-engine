'use client'

import { useEffect } from 'react'

import { preserveUtmParams } from '@/lib/analytics/ga'
import { shouldTrackFirstVisit, trackEvent } from '@/lib/track'

export default function LandingPageTracker() {
  useEffect(() => {
    preserveUtmParams()
    if (shouldTrackFirstVisit()) {
      void trackEvent('first_visit')
    }
    void trackEvent('landing_page_view')
  }, [])

  return null
}
