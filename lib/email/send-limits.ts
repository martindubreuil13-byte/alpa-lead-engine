export const DAILY_EMAIL_LIMIT = 100
export const ADMIN_DAILY_EMAIL_LIMIT = 500
export const DAILY_LIMIT_WARNING_THRESHOLD = 20

export type EmailLimitErrorCode = 'DAILY_LIMIT_REACHED'

export type EmailUsageSnapshot = {
  sent: number
  limit: number
  remaining: number
  date: string
  timeZone: string
}

export function getDailyEmailLimit(resolvedPlan: string | null | undefined) {
  return resolvedPlan === 'admin' ? ADMIN_DAILY_EMAIL_LIMIT : DAILY_EMAIL_LIMIT
}

export function getEmailLimitFeedback(errorCode: string) {
  if (errorCode === 'DAILY_LIMIT_REACHED') {
    return {
      title: 'Daily Sending Limit Reached',
      message:
        'To protect your email deliverability and avoid spam flags, we limit daily sends. You’ve reached today’s limit. You can resume sending tomorrow or upgrade for higher limits.',
      subtext: 'This helps keep your emails landing in inboxes, not spam.',
    }
  }

  return {
    title: 'Email Sending Unavailable',
    message: 'ALPA could not send this email right now. Please try again in a moment.',
    subtext: '',
  }
}
