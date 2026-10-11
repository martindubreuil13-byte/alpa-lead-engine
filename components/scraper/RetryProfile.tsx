'use client'

import { useState } from 'react'

// Shown only for a failed profile the server would accept a retry for. One request at a time; the message explains a refusal.
export default function RetryProfile({ leadId, onRetry }: { leadId: string; onRetry: (leadId: string) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <div className="relative z-10 mt-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy) return
          setBusy(true)
          setMessage(await onRetry(leadId))
          setBusy(false)
        }}
        className={`inline-flex min-h-[44px] items-center rounded-sm text-xs font-medium uppercase tracking-[0.14em] text-[#7a5f27] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27] disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {busy ? 'Requesting retry…' : 'Retry Business Profile'}
      </button>
      {message ? <p role="status" className={`text-xs text-[#5b6372]`}>{message}</p> : null}
    </div>
  )
}
