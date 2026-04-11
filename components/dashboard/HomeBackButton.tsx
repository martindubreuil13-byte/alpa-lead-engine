'use client'

import { useRouter } from 'next/navigation'

export default function HomeBackButton({ className = '' }: { className?: string }) {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => router.push('/')}
      className={`inline-flex items-center text-sm text-white/70 transition hover:text-white ${className}`.trim()}
    >
      ← Home
    </button>
  )
}
