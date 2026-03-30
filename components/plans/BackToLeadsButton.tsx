'use client'

import { useRouter } from 'next/navigation'

export default function BackToLeadsButton() {
  const router = useRouter()

  function handleBack() {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push('/dashboard/leads')
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className="inline-flex items-center gap-2 text-sm font-medium text-cyan-100 transition hover:text-white"
    >
      ← Back to your leads
    </button>
  )
}
