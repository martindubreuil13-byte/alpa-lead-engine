'use client'

import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { trackEvent } from '@/lib/track'

export default function FreshStartCta({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  function getCtaLocation() {
    const sourcePage = getSourcePage()
    if (sourcePage === '/') return 'hero'
    if (sourcePage === '/plans') return 'plans_page'
    if (sourcePage?.startsWith('/resources') || sourcePage === '/about') return 'final_cta'
    return 'other'
  }

  function handleClick() {
    const sourcePage = getSourcePage()
    trackGaEvent('free_trial_cta_click', {
      cta_location: getCtaLocation(),
      source_page: sourcePage,
      visitor_type: 'anonymous',
    })
    void trackEvent('trial_started', { metadata: { source: 'landing_cta' } })
    window.dispatchEvent(new CustomEvent('alpa:open-trial-flow'))
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  )
}
