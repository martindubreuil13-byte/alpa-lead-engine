import Link from 'next/link'

import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import { cn } from '@/lib/utils'

export type PlanCardProps = {
  name: string
  price: string
  priceSuffix?: string
  description: string
  features: string[]
  ctaLabel: string
  href?: string
  checkoutSource?: string
  priceNote?: string
  featured?: boolean
  disabled?: boolean
}

function FeatureMark({ featured, disabled }: { featured: boolean; disabled: boolean }) {
  return (
    <span
      className={cn(
        'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
        featured
          ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
          : disabled
            ? 'border-white/10 bg-white/[0.03] text-slate-400'
            : 'border-white/12 bg-white/[0.04] text-slate-200'
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <path
          d="M4 8.2 6.5 10.7 12 5.3"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export default function PlanCard({
  name,
  price,
  priceSuffix,
  description,
  features,
  ctaLabel,
  href,
  checkoutSource,
  priceNote,
  featured = false,
  disabled = false,
}: PlanCardProps) {
  return (
    <div
      aria-disabled={disabled}
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-[30px] border p-6 shadow-[0_24px_80px_rgba(2,8,23,0.46)] backdrop-blur-2xl sm:p-7',
        featured
          ? 'border-cyan-300/28 bg-[linear-gradient(180deg,rgba(34,211,238,0.13),rgba(15,23,42,0.9))] shadow-[0_28px_96px_rgba(8,145,178,0.26)] xl:scale-[1.015]'
          : 'border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]',
        disabled
          ? 'opacity-75'
          : 'transition duration-300 hover:-translate-y-1 hover:border-white/14 hover:shadow-[0_30px_90px_rgba(2,8,23,0.54)]'
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 opacity-100',
          featured
            ? 'bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_34%),linear-gradient(180deg,transparent,rgba(6,182,212,0.05))]'
            : 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_36%)]'
        )}
      />
      <div
        className={cn(
          'pointer-events-none absolute right-[-3rem] top-[-3rem] h-28 w-28 rounded-full blur-3xl',
          featured ? 'bg-cyan-300/16' : disabled ? 'bg-slate-300/8' : 'bg-teal-300/10'
        )}
      />

      <div className="relative flex h-full flex-col">
        <div className="min-h-[2.75rem]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            {name}
          </div>
        </div>

        <div className="mt-6 min-h-[6.5rem]">
          <div
            className={cn(
              'flex items-end gap-2 text-[2.7rem] font-semibold leading-none tracking-[-0.06em] sm:text-[3rem]',
              featured ? 'text-white' : disabled ? 'text-slate-200' : 'text-white'
            )}
          >
            <span>{price}</span>
            {priceSuffix ? (
              <span className="pb-1 text-base font-medium tracking-[-0.02em] text-slate-400">
                {priceSuffix}
              </span>
            ) : null}
          </div>
          {priceNote ? (
            <div className="mt-3 text-sm font-medium text-cyan-100/80">{priceNote}</div>
          ) : null}
        </div>

        <p className="mt-6 min-h-[6.5rem] text-sm leading-7 text-slate-300">{description}</p>

        <div className="mt-8 space-y-3">
          {features.map((feature) => (
            <div key={feature} className="flex items-start gap-3">
              <FeatureMark featured={featured} disabled={disabled} />
              <span className="text-sm leading-6 text-slate-200">{feature}</span>
            </div>
          ))}
        </div>

        <div className="mt-auto pt-10">
          {disabled ? (
            <span className="inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] px-5 text-sm font-semibold text-slate-400">
              {ctaLabel}
            </span>
          ) : checkoutSource ? (
            <StartCheckoutButton
              label={ctaLabel}
              source={checkoutSource}
              className={cn(
                'inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl px-5 text-sm font-semibold transition duration-300',
                featured
                  ? 'border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]'
                  : 'border border-cyan-300/18 bg-white/[0.05] text-white shadow-[0_16px_36px_rgba(2,8,23,0.26)] hover:border-cyan-300/24 hover:bg-cyan-300/[0.08]'
              )}
            />
          ) : !href ? (
            <span className="inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] px-5 text-sm font-semibold text-slate-400">
              {ctaLabel}
            </span>
          ) : (
            <Link
              href={href}
              className={cn(
                'inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl px-5 text-sm font-semibold transition duration-300',
                featured
                  ? 'border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]'
                  : 'border border-cyan-300/18 bg-white/[0.05] text-white shadow-[0_16px_36px_rgba(2,8,23,0.26)] hover:border-cyan-300/24 hover:bg-cyan-300/[0.08]'
              )}
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
