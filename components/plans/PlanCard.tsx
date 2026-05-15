import Link from 'next/link'

import FreeTrialPlanLink from '@/components/plans/FreeTrialPlanLink'
import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import { cn } from '@/lib/utils'

export type PlanCardProps = {
  name: string
  price: string
  priceSuffix?: string
  pricePerLead?: string
  description: string
  features: string[]
  ctaLabel: string
  href?: string
  checkoutSource?: string
  checkoutPlan?: 'starter' | 'prospector'
  badge?: string
  featured?: boolean
  highlight?: boolean
  disabled?: boolean
}

function FeatureMark({ featured, highlight, disabled }: { featured: boolean; highlight: boolean; disabled: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
        featured
          ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
          : highlight
            ? 'border-blue-400/25 bg-blue-400/10 text-blue-200'
            : disabled
              ? 'border-white/10 bg-white/[0.03] text-slate-500'
              : 'border-white/12 bg-white/[0.04] text-slate-300'
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
  pricePerLead,
  description,
  features,
  ctaLabel,
  href,
  checkoutSource,
  checkoutPlan,
  badge,
  featured = false,
  highlight = false,
  disabled = false,
}: PlanCardProps) {
  return (
    <div
      aria-disabled={disabled}
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-[28px] border p-6 shadow-[0_24px_80px_rgba(2,8,23,0.46)] backdrop-blur-2xl sm:p-7',
        featured
          ? 'border-cyan-300/28 bg-[linear-gradient(180deg,rgba(34,211,238,0.13),rgba(15,23,42,0.9))] shadow-[0_28px_96px_rgba(8,145,178,0.26)] xl:scale-[1.015]'
          : highlight
            ? 'border-blue-400/22 bg-[linear-gradient(180deg,rgba(59,130,246,0.09),rgba(15,23,42,0.88))]'
            : disabled
              ? 'border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] opacity-70'
              : 'border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]',
        !disabled && 'transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_90px_rgba(2,8,23,0.54)]',
        featured && !disabled && 'hover:border-cyan-300/35',
        highlight && !disabled && 'hover:border-blue-400/32',
        !featured && !highlight && !disabled && 'hover:border-white/14'
      )}
    >
      {/* Inner glow overlay */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0',
          featured
            ? 'bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_34%),linear-gradient(180deg,transparent,rgba(6,182,212,0.05))]'
            : highlight
              ? 'bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.13),transparent_34%)]'
              : 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_36%)]'
        )}
      />
      {/* Corner glow blob */}
      <div
        className={cn(
          'pointer-events-none absolute right-[-3rem] top-[-3rem] h-28 w-28 rounded-full blur-3xl',
          featured ? 'bg-cyan-300/16' : highlight ? 'bg-blue-400/12' : disabled ? 'bg-slate-300/5' : 'bg-teal-300/8'
        )}
      />

      <div className="relative flex h-full flex-col">
        {/* Plan name + badge */}
        <div className="flex items-center justify-between gap-2 min-h-[1.75rem]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            {name}
          </div>
          {badge ? (
            <span
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]',
                featured
                  ? 'bg-cyan-300/15 text-cyan-200'
                  : disabled
                    ? 'bg-white/[0.05] text-slate-500'
                    : 'bg-blue-400/12 text-blue-300'
              )}
            >
              {badge}
            </span>
          ) : null}
        </div>

        {/* Price block */}
        <div className="mt-6 min-h-[5.5rem]">
          <div
            className={cn(
              'flex items-end gap-2 text-[2.6rem] font-semibold leading-none tracking-[-0.06em] sm:text-[2.9rem]',
              disabled ? 'text-slate-400' : 'text-white'
            )}
          >
            <span>{price}</span>
            {priceSuffix ? (
              <span className="pb-1 text-base font-medium tracking-[-0.02em] text-slate-400">
                {priceSuffix}
              </span>
            ) : null}
          </div>
          {pricePerLead ? (
            <div
              className={cn(
                'mt-2.5 text-xs font-medium',
                featured ? 'text-cyan-200/70' : highlight ? 'text-blue-300/70' : 'text-slate-500'
              )}
            >
              {pricePerLead}
            </div>
          ) : null}
        </div>

        {/* Description */}
        <p
          className={cn(
            'mt-5 min-h-[5rem] text-sm leading-7',
            disabled ? 'text-slate-500' : 'text-slate-300'
          )}
        >
          {description}
        </p>

        {/* Feature list */}
        <div className="mt-7 space-y-3">
          {features.map((feature) => (
            <div key={feature} className="flex items-start gap-3">
              <FeatureMark featured={featured} highlight={highlight} disabled={disabled} />
              <span
                className={cn(
                  'text-sm leading-6',
                  disabled ? 'text-slate-500' : 'text-slate-200'
                )}
              >
                {feature}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-auto pt-9">
          {disabled ? (
            <span className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/6 bg-white/[0.025] px-5 text-sm font-semibold text-slate-600">
              {ctaLabel}
            </span>
          ) : checkoutSource ? (
            <StartCheckoutButton
              label={ctaLabel}
              source={checkoutSource}
              plan={checkoutPlan ?? 'starter'}
              className={cn(
                'inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl px-5 text-sm font-semibold transition-all duration-200',
                featured
                  ? 'border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]'
                  : highlight
                    ? 'border border-blue-400/30 bg-[linear-gradient(135deg,rgba(37,99,235,0.5),rgba(79,70,229,0.4))] text-white shadow-[0_0_14px_rgba(59,130,246,0.22)] hover:border-blue-400/45 hover:shadow-[0_0_22px_rgba(59,130,246,0.4)] active:scale-[0.98]'
                    : 'border border-white/10 bg-white/[0.05] text-white shadow-[0_16px_36px_rgba(2,8,23,0.26)] hover:border-white/16 hover:bg-white/[0.08]'
              )}
            />
          ) : href === '/dashboard/scraper' ? (
            <FreeTrialPlanLink
              href={href}
              ctaLocation="plans_page"
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-sm font-semibold text-white transition-all duration-200 hover:border-white/16 hover:bg-white/[0.08]"
            >
              {ctaLabel}
            </FreeTrialPlanLink>
          ) : href ? (
            <Link
              href={href}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-sm font-semibold text-white transition-all duration-200 hover:border-white/16 hover:bg-white/[0.08]"
            >
              {ctaLabel}
            </Link>
          ) : (
            <span className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/6 bg-white/[0.025] px-5 text-sm font-semibold text-slate-600">
              {ctaLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
