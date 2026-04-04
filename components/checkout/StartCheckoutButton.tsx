'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { getGuestCaptureEmail, saveGuestCaptureEmail } from '@/lib/guest-session'

type StartCheckoutButtonProps = {
  label: string
  className?: string
  email?: string | null
  source?: string
  disabled?: boolean
  disabledLabel?: string
}

export default function StartCheckoutButton({
  label,
  className,
  email,
  source = 'upgrade',
  disabled = false,
  disabledLabel = label,
}: StartCheckoutButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleCheckout() {
    if (loading || disabled) return

    setLoading(true)
    const normalizedEmail = String(email || getGuestCaptureEmail()).trim().toLowerCase()

    if (normalizedEmail) {
      saveGuestCaptureEmail(normalizedEmail)
    }

    const params = new URLSearchParams({ mock: 'true', source })
    window.setTimeout(() => {
      router.push(`/post-checkout?${params.toString()}`)
    }, 450)
  }

  return (
    <button type="button" onClick={() => void handleCheckout()} disabled={disabled || loading} className={className}>
      {loading ? 'Redirecting...' : disabled ? disabledLabel : label}
    </button>
  )
}
