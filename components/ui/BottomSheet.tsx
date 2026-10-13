'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// An accessible bottom sheet for phones: a labelled modal dialog that traps focus, closes with Escape, the close button or a tap on
// the backdrop, locks the page behind it from scrolling, and returns focus to whatever opened it.
export default function BottomSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-[#020617]/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-[#f7f5ef] text-[#0b1a33] shadow-[0_-20px_60px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-start gap-3 border-b border-[#d9d3c4] px-5 pb-3 pt-3">
          <div className="min-w-0 flex-1">
            <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[#d9d3c4]" />
            <h2 id="sheet-title" className="font-display text-2xl leading-tight text-[#0b1a33]">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-[#5b6372]">{subtitle}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#0b1a33] outline-none transition hover:bg-[#0b1a33]/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7a5f27]"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5">{children}</div>
      </div>
    </div>
  )
}
