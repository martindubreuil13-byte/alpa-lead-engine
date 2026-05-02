'use client'

import { useEffect } from 'react'

import { preserveUtmParams } from '@/lib/analytics/ga'
import { trackEvent } from '@/lib/track'

export default function LandingPageTracker() {
  useEffect(() => {
    preserveUtmParams()
    void trackEvent('landing_page_view')
  }, [])

  return null
}
