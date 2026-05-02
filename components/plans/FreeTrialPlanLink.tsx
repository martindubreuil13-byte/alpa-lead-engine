'use client'

import Link from 'next/link'

import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'

export default function FreeTrialPlanLink({
  href,
  className,
  children,
  ctaLocation = 'plans_page',
}: {
  href: string
  className?: string
  children: React.ReactNode
  ctaLocation?: 'plans_page' | 'pricing_page' | 'pricing_teaser' | 'final_cta' | 'other'
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        trackGaEvent('free_trial_cta_click', {
          cta_location: ctaLocation,
          source_page: getSourcePage(),
          visitor_type: 'unknown',
        })
      }}
    >
      {children}
    </Link>
  )
}

