'use client'

import { useRouter } from 'next/navigation'

import { resetGuestSession } from '@/lib/session/resetGuestSession'

export default function FreshStartCta({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()

  function handleClick() {
    resetGuestSession({ regenerateSessionId: true })
    router.push('/dashboard/scraper')
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  )
}
