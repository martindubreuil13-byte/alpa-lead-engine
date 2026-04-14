'use client'

import { useEffect } from 'react'

import { trackEvent } from '@/lib/track'

export default function LandingPageTracker() {
  useEffect(() => {
    void trackEvent('landing_page_view')
  }, [])

  return null
}
