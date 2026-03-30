'use client'

import { useRouter } from 'next/navigation'

import { supabase } from '@/lib/supabase'
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

  async function handleClick() {
    console.log('LANDING CTA: forcing guest trial mode')
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
