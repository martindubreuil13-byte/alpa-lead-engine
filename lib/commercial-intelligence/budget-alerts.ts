// Budget alert support for paid research: how much of this month's global research budget is used, and which alert levels (50%
// and 80%) that has crossed. This only READS spend and DECIDES what should be said. Nothing here sends a message, schedules a
// job or changes a limit; wiring it to a notification channel or a scheduler is a separate, approved step.

export const BUDGET_ALERT_THRESHOLDS = [50, 80] as const

export type BudgetLevel = 'ok' | 'notice' | 'warning' | 'exhausted'

export type BudgetEvaluation = {
  spentUsd: number
  limitUsd: number | null
  percent: number | null
  level: BudgetLevel
  /** Every threshold at or below the current use. */
  crossed: number[]
  /** Thresholds crossed that are not in `notified`: the alerts that should go out. */
  due: number[]
  message: string | null
}

const dollars = (value: number) => `$${value.toFixed(value < 1 ? 4 : 2)}`

export function evaluateBudget(input: { spentUsd: number; limitUsd: number | null; notified?: number[] }): BudgetEvaluation {
  const spentUsd = Number.isFinite(input.spentUsd) && input.spentUsd > 0 ? input.spentUsd : 0
  const limitUsd = input.limitUsd !== null && Number.isFinite(input.limitUsd) && input.limitUsd > 0 ? input.limitUsd : null
  if (limitUsd === null) {
    // No configured limit fails closed in the database; here it is simply reported as not measurable.
    return { spentUsd, limitUsd: null, percent: null, level: 'ok', crossed: [], due: [], message: null }
  }
  const percent = (spentUsd / limitUsd) * 100
  const crossed = BUDGET_ALERT_THRESHOLDS.filter((threshold) => percent >= threshold)
  const due = crossed.filter((threshold) => !(input.notified ?? []).includes(threshold))
  const level: BudgetLevel = percent >= 100 ? 'exhausted' : percent >= 80 ? 'warning' : percent >= 50 ? 'notice' : 'ok'
  const top = crossed[crossed.length - 1]
  const message =
    level === 'exhausted'
      ? `Research budget used up: ${dollars(spentUsd)} of ${dollars(limitUsd)} this month. New research is paused until the limit is raised or the month turns over.`
      : top !== undefined
        ? `Research budget is ${Math.floor(percent)}% used (${dollars(spentUsd)} of ${dollars(limitUsd)}) this month; the ${top}% alert level has been reached.`
        : null
  return { spentUsd, limitUsd, percent, level, crossed: [...crossed], due: [...due], message }
}

type Client = any

/** This month's research spend (settled actual, else reservation) and the configured global limit. Read-only. */
export async function readMonthlyBudget(admin: Client, now: Date = new Date()): Promise<{ spentUsd: number; limitUsd: number | null }> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const [charges, controls] = await Promise.all([
    admin.from('ci_research_charges').select('actual_usd, reserved_usd').gte('created_at', monthStart),
    admin.from('ci_research_controls').select('global_monthly_limit_usd').maybeSingle(),
  ])
  if (charges.error || controls.error) throw new Error('Budget could not be read')
  const spentUsd = (charges.data ?? []).reduce((total: number, row: { actual_usd: number | string | null; reserved_usd: number | string }) => total + Number(row.actual_usd ?? row.reserved_usd ?? 0), 0)
  const limit = controls.data?.global_monthly_limit_usd
  return { spentUsd, limitUsd: limit === null || limit === undefined ? null : Number(limit) }
}
