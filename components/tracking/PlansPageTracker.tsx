'use client'

import { useEffect } from 'react'

import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { trackEvent } from '@/lib/track'

export default function PlansPageTracker() {
  useEffect(() => {
    void trackEvent('plans_viewed')
    trackGaEvent('plans_viewed', {
      source_page: getSourcePage(),
      visitor_type: 'unknown',
    })
  }, [])

  return null
}
