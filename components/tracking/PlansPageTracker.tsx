'use client'

import { useEffect } from 'react'

import { trackEvent } from '@/lib/track'

export default function PlansPageTracker() {
  useEffect(() => {
    void trackEvent('plans_viewed')
  }, [])

  return null
}
