'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

type BillingPlanActionsProps = {
  initialState: {
    planStatus: string | null
    cancelAtPeriodEnd: boolean
    currentPeriodEnd: string | null
    subscriptionTier: string | null
    hasStripeSubscription: boolean
    hasStripeCustomer: boolean
    subscriptionActive: boolean
  }
}

function formatBillingDate(value: string | null | undefined) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export default function BillingPlanActions({ initialState }: BillingPlanActionsProps) {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [action, setAction] = useState<'cancel' | 'resume' | null>(null)
  const [, startTransition] = useTransition()
  const actionInFlight = useRef(false)

  const accessDate = formatBillingDate(state.currentPeriodEnd)
  const isCanceling = state.cancelAtPeriodEnd || state.planStatus === 'canceling'
  const isCanceled = state.planStatus === 'canceled'
  const hasBillingLink = state.hasStripeSubscription || state.hasStripeCustomer
  const canManage =
    hasBillingLink &&
    !isCanceled &&
    (state.subscriptionActive || state.subscriptionTier !== 'free')
  const isBusy = action !== null

  async function runBillingAction(nextAction: 'cancel' | 'resume') {
    if (actionInFlight.current) return

    actionInFlight.current = true
    setAction(nextAction)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/billing/${nextAction}`, {
        method: 'POST',
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error || `Unable to ${nextAction} plan`)
      }

      setState((current) => ({
        ...current,
        planStatus: payload.plan_status || payload.subscription_status || payload.status || current.planStatus,
        cancelAtPeriodEnd: Boolean(payload.cancel_at_period_end),
        currentPeriodEnd: payload.current_period_end ?? current.currentPeriodEnd,
        hasStripeSubscription: true,
        hasStripeCustomer: Boolean(payload.stripe_customer_id || current.hasStripeCustomer),
        subscriptionActive: payload.subscription_active ?? true,
      }))
      setSuccess(
        nextAction === 'cancel'
          ? 'Plan cancellation scheduled. Your access remains active until the end of the billing period.'
          : 'Plan resumed. Your subscription will renew as usual.'
      )
      setConfirming(false)
      startTransition(() => {
        router.refresh()
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Billing action failed')
    } finally {
      setAction(null)
      actionInFlight.current = false
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
            Subscription
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              isCanceling
                ? 'border-amber-300/30 bg-amber-400/10 text-amber-100'
                : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
            }`}
          >
            {isCanceling ? 'Canceling' : 'Active'}
          </span>
        </div>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          {isCanceling ? (
            <>
              <p className="font-semibold text-amber-100">Canceling on {accessDate ?? 'period end'}</p>
              <p>Access until {accessDate ?? 'your current billing period ends'}.</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-emerald-100">Active</p>
              <p>Renewal date: {accessDate ?? 'the next billing date'}.</p>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {success}
        </div>
      ) : null}

      {canManage ? (
        <div className="rounded-2xl border border-white/10 bg-[#0b1220]/70 p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Manage Subscription
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            {isCanceling
              ? 'Resume your plan before the period ends to keep renewal active.'
              : 'Canceling schedules the subscription to end at the close of the current billing period.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isCanceling ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runBillingAction('resume')}
                className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {action === 'resume' ? 'Resuming...' : 'Resume Plan'}
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setConfirming(true)}
                className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel Plan
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          Billing management is unavailable because no active Stripe subscription is linked to this account.
        </div>
      )}

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0b1220] p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
              Confirm Cancellation
            </div>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">
              Cancel your plan?
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Your subscription will stay active until {accessDate ?? 'the end of your current billing period'}.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setConfirming(false)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Keep Plan
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runBillingAction('cancel')}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-red-300/30 bg-red-500/15 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {action === 'cancel' ? 'Canceling...' : 'Cancel Plan'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
