'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const usuallyHelps = [
  'shorter emails',
  'natural language',
  'smaller sending batches',
  'personalized outreach',
  'fewer links',
  'real conversations and replies',
]

const oftenHurts = [
  'overly promotional wording',
  'repetitive mass sending',
  'excessive claims',
  'too many links',
  'sending large volumes immediately',
  'repeatedly testing emails to yourself',
]

export default function InboxVisibilityGuide() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <section className="rounded-[24px] border border-emerald-300/14 bg-emerald-400/[0.06] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-white">Improve Inbox Visibility</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Short, natural emails usually perform better.
            </p>
          </div>

          <div className="space-y-2 text-sm leading-6 text-slate-400">
            <p>Things that may increase spam risk include:</p>
            <ul className="grid list-disc gap-1 pl-4 text-slate-300 marker:text-emerald-300/70 sm:grid-cols-2">
              <li>too many links</li>
              <li>aggressive sales language</li>
              <li>ALL CAPS</li>
              <li>excessive claims</li>
              <li className="sm:col-span-2">repeated mass sending</li>
            </ul>
            <p>
              Emails that feel more human and conversational are more likely to reach the inbox.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-emerald-100 transition hover:bg-white/[0.08]"
          aria-expanded={isOpen}
        >
          Learn more
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {isOpen ? (
        <div className="mt-4 border-t border-white/8 pt-4">
          <h4 className="text-sm font-semibold text-white">
            Better Deliverability Starts With Better Emails
          </h4>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            ALPA handles the sending infrastructure, but inbox placement also depends on how
            email providers evaluate sender behavior and message quality.
          </p>

          <div className="mt-4 grid gap-4 text-sm leading-6 md:grid-cols-2">
            <div>
              <div className="font-medium text-emerald-100">Usually helps:</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300 marker:text-emerald-300/70">
                {usuallyHelps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <div className="font-medium text-slate-100">Often hurts:</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-300 marker:text-slate-500">
                {oftenHurts.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            The goal is simple: write emails that sound like a real human conversation.
          </p>
        </div>
      ) : null}
    </section>
  )
}
