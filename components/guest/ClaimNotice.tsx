'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'

import { describeClaimNotice, type ClaimNotice as Notice } from '@/lib/guest/claim-notice'
import { clearStoredGuestClaimResult, readStoredGuestClaimResult } from '@/lib/session/scrape-result'
import { cn } from '@/lib/utils'

// Shown once after a free-trial import, on the pages a new member lands on, until it is dismissed.
export default function ClaimNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)
  useEffect(() => setNotice(describeClaimNotice(readStoredGuestClaimResult())), [])
  if (!notice) return null
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', notice.tone === 'attention' ? 'border-[#d8c28a]/40 bg-[#d8c28a]/[0.07] text-white/90' : 'border-white/12 bg-white/[0.04] text-white/80')}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-white">{notice.title}</p>
        <p className="leading-6 text-white/70">{notice.body}</p>
        {notice.showTrialLink || notice.showPlansLink ? (
          <p className="flex flex-wrap gap-x-5 pt-0.5">
            {notice.showTrialLink ? <Link href="/trial/results" className="inline-flex min-h-[44px] items-center text-[#d8c28a] underline-offset-4 hover:underline">View them →</Link> : null}
            {notice.showPlansLink ? <Link href="/plans" className="inline-flex min-h-[44px] items-center text-white/80 underline underline-offset-4 hover:text-[#d8c28a]">Explore plans</Link> : null}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => { clearStoredGuestClaimResult(); setNotice(null) }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 outline-none transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d8c28a]"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  )
}
