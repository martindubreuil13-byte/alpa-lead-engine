'use client'

import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { OPEN_TRIAL_HREF, requestTrialOpen } from '@/lib/guest/open-request'
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

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // Once the page is interactive the dialog opens in place. Before that (a tap during page load) the link itself is followed
    // and the landing page opens the dialog on arrival, so the tap is never lost.
    event.preventDefault()
    const sourcePage = getSourcePage()
    trackGaEvent('free_trial_cta_click', {
      cta_location: getCtaLocation(),
      source_page: sourcePage,
      visitor_type: 'anonymous',
    })
    void trackEvent('trial_started', { metadata: { source: 'landing_cta' } })
    requestTrialOpen()
  }

  return (
    <a href={OPEN_TRIAL_HREF} onClick={handleClick} className={className}>
      {children}
    </a>
  )
}
