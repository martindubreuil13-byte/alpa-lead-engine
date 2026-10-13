'use client'

import { useEffect } from 'react'
import Link from 'next/link'

import { buildConversionCopy, FIRST_MONTH_OFFER, type ConversionKind } from '@/lib/billing/first-month-offer'
import { trackEvent } from '@/lib/track'

// The free-to-paid moment, for a visitor (or free member) who has used their free businesses and asks for more. It is a calm page,
// not a pop-up: no countdown, no urgency, no email. The discount is only previewed (see lib/billing/first-month-offer.ts): the
// button goes to the regular plans and the panel says plainly that the offer is not active yet.
export default function UpgradePanel({
  kind,
  saved,
  eligible,
  audience,
  secondaryHref,
  plansHref = '/plans',
}: {
  kind: ConversionKind
  saved: number
  eligible: boolean
  audience: 'guest' | 'free_member'
  secondaryHref: string
  plansHref?: string
}) {
  const copy = buildConversionCopy({ kind, saved, eligible })

  useEffect(() => {
    void trackEvent('conversion_offer_viewed', { metadata: { audience, kind, eligible, offer_status: FIRST_MONTH_OFFER.status } })
  }, [audience, kind, eligible])

  const clicked = (which: 'plans' | 'businesses') => void trackEvent('conversion_cta_clicked', { metadata: { audience, kind, eligible, which } })

  return (
    <section aria-labelledby="upgrade-title" className="dash-rise mx-auto w-full max-w-3xl pt-2 sm:pt-6">
      <span aria-hidden="true" className="block h-px w-10 bg-[#d8c28a]" />
      <h1 id="upgrade-title" className="mt-5 font-display text-[2.4rem] leading-[1.04] tracking-tight text-white/95 sm:text-[3.4rem]">
        {copy.headline}
      </h1>
      <p className="mt-4 text-lg leading-8 text-white/75">{copy.support}</p>

      {copy.offerLine ? (
        <div className="mt-8 rounded-2xl border border-[#d8c28a]/30 bg-[#d8c28a]/[0.06] p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-display text-4xl leading-none text-[#d8c28a]">{FIRST_MONTH_OFFER.percentOff}% off</span>
            {copy.offerBadge ? (
              <span className="rounded-full border border-[#d8c28a]/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#e9dcb6]">{copy.offerBadge}</span>
            ) : null}
          </div>
          <p className="mt-3 text-base leading-7 text-white/90">{copy.offerLine}</p>
          {copy.terms ? <p className="mt-2 text-sm leading-6 text-white/65">{copy.terms}</p> : null}
          {copy.inactiveNotice ? <p role="note" className="mt-3 border-t border-white/10 pt-3 text-sm leading-6 text-[#e9dcb6]">{copy.inactiveNotice}</p> : null}
          {copy.activeNotice ? <p className="mt-3 border-t border-white/10 pt-3 text-sm leading-6 text-[#e9dcb6]">{copy.activeNotice}</p> : null}
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
        <Link href={plansHref} onClick={() => clicked('plans')} className="btn-primary-gold btn-quiet w-full px-4 text-[13px] uppercase tracking-[0.08em] sm:w-auto sm:px-7 sm:text-sm sm:tracking-[0.14em]">
          {copy.primaryCta}
        </Link>
        <Link href={secondaryHref} onClick={() => clicked('businesses')} className="inline-flex min-h-[48px] items-center rounded text-base text-[#d8c28a] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]">
          {copy.secondaryCta}
        </Link>
      </div>
    </section>
  )
}
