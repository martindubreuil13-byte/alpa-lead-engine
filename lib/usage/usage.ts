import { isAdminPlan, isPaidPlan } from '@/lib/auth/access'

type CountableLead = {
  email?: string | null
  phone?: string | null
}

const USAGE_STORAGE_PREFIX = 'alpa_usage'

export const LEAD_LIMIT_REACHED_MESSAGE = "You've reached your limit. Upgrade to continue."
export const STARTER_LOCK_MESSAGE = 'Available on Starter plan'

export function getLeadLimit(plan: string) {
  if (isAdminPlan(plan)) return 10000
  if (plan === 'prospector') return 120
  if (isPaidPlan(plan)) return 500
  return 25
}

export function isCountableLead(lead: CountableLead) {
  return Boolean(lead.email || lead.phone)
}

export function countCountableLeads<T extends CountableLead>(leads: T[]) {
  return leads.filter(isCountableLead).length
}

export function getRemainingLeadCapacity(leadsUsed: number, plan: string) {
  return Math.max(getLeadLimit(plan) - getClampedLeadUsage(leadsUsed, plan), 0)
}

export function isNearLeadLimit(leadsUsed: number, limit: number) {
  if (limit <= 0) return false
  return leadsUsed / limit >= 0.8
}

export function getClampedLeadUsage(leadsUsed: number, plan: string) {
  const limit = getLeadLimit(plan)
  return Math.max(0, Math.min(leadsUsed, limit))
}

export function getUsageState(count: number, limit: number) {
  if (count >= limit) return 'blocked'
  if (count >= limit * 0.8) return 'warning'
  return 'normal'
}

export function getUsageWarningMessage(count: number, limit: number) {
  return `You're close to your free limit (${count} / ${limit})`
}

export function getUsageBlockedMessage(plan: string, limit: number) {
  if (plan === 'free') {
    return `You've reached your ${limit} free leads. Upgrade to continue discovering new clients.`
  }

  return "You've reached your lead limit. Upgrade to continue."
}

export function getUsageStorageKey(sessionKey: string) {
  return `${USAGE_STORAGE_PREFIX}:${sessionKey}`
}

export function readStoredUsage(sessionKey: string) {
  if (typeof window === 'undefined') return 0

  const raw = window.localStorage.getItem(getUsageStorageKey(sessionKey))
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function writeStoredUsage(sessionKey: string, leadsUsed: number, plan = 'free') {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    getUsageStorageKey(sessionKey),
    String(getClampedLeadUsage(leadsUsed, plan))
  )
}
