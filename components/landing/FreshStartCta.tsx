'use client'

import { useRouter } from 'next/navigation'

import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/track'
import { enableGuestTrialMode } from '@/lib/session/guest-trial-mode'
import { resetGuestSession } from '@/lib/session/resetGuestSession'

export default function FreshStartCta({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()

  function getCtaLocation() {
    const sourcePage = getSourcePage()
    if (sourcePage === '/') return 'hero'
    if (sourcePage === '/plans') return 'plans_page'
    if (sourcePage?.startsWith('/resources') || sourcePage === '/about') return 'final_cta'
    return 'other'
  }

  async function handleClick() {
    const sourcePage = getSourcePage()
    const visitorType = 'anonymous'
    trackGaEvent('free_trial_cta_click', {
      cta_location: getCtaLocation(),
      source_page: sourcePage,
      visitor_type: visitorType,
    })
    void trackEvent('trial_started', {
      metadata: {
        source: 'landing_cta',
      },
    })
    enableGuestTrialMode()
    resetGuestSession({ regenerateSessionId: true })
    await supabase.auth.signOut()
    router.push('/dashboard/scraper')
  }

  return (
    <button type="button" onClick={() => void handleClick()} className={className}>
      {children}
    </button>
  )
}
