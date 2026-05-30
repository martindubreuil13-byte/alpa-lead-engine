import { redirect } from 'next/navigation'

import LeadFollowUpsAdmin, { type LeadCaptureRow } from '@/components/admin/LeadFollowUpsAdmin'
import DashboardShell from '@/components/dashboard/DashboardShell'
import {
  DEFAULT_FOLLOW_UP_SETTINGS,
  getEffectiveFollowUpSettings,
  isExcludedEmail,
  normalizeEmail,
  type FollowUpSettingsRow,
  type LeadFollowUpRow,
} from '@/lib/admin/lead-follow-ups'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

type ActivityLogRow = Database['public']['Tables']['activity_logs']['Row']
type UserRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'email' | 'plan' | 'created_at'>

function getCaptureStatus(params: {
  captureDate: string
  followUp: LeadFollowUpRow | null
  delayDays: number
}): LeadCaptureRow['status'] {
  if (params.followUp?.followup_sent || params.followUp?.follow_up_sent_at || params.followUp?.status === 'sent') {
    return 'Follow-Up Sent'
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - params.delayDays)

  return new Date(params.captureDate).getTime() <= cutoff.getTime()
    ? 'Pending Follow-Up'
    : 'Downloaded'
}

function buildRows(params: {
  logs: ActivityLogRow[]
  users: UserRow[]
  followUps: LeadFollowUpRow[]
  delayDays: number
  exclusionPatterns: string[]
}) {
  const usersById = new Map(params.users.map((user) => [user.id, user]))
  const followUpsByEmail = new Map<string, LeadFollowUpRow>()
  const followUpsBySource = new Map<string, LeadFollowUpRow>()

  for (const followUp of params.followUps) {
    const email = normalizeEmail(followUp.email)
    if (email && !followUpsByEmail.has(email)) {
      followUpsByEmail.set(email, followUp)
    }
    if (followUp.source_activity_id) {
      followUpsBySource.set(followUp.source_activity_id, followUp)
    }
  }

  const rowsByEmail = new Map<string, LeadCaptureRow>()

  for (const log of params.logs) {
    if (log.event !== 'email_export_sent') continue

    const user = log.user_id ? usersById.get(log.user_id) : null
    if (user?.plan === 'admin') continue
    const email = normalizeEmail(log.email) || normalizeEmail(user?.email)
    if (!email || isExcludedEmail(email, params.exclusionPatterns)) continue

    const existingRow = rowsByEmail.get(email)
    if (existingRow && new Date(existingRow.captureDate).getTime() <= new Date(log.created_at).getTime()) {
      continue
    }

    const followUp = followUpsBySource.get(log.id) || followUpsByEmail.get(email) || null

    rowsByEmail.set(email, {
      rowKey: email,
      followUpId: followUp?.id ?? null,
      sourceActivityId: log.id,
      email,
      captureDate: log.created_at,
      status: getCaptureStatus({
        captureDate: log.created_at,
        followUp,
        delayDays: params.delayDays,
      }),
      followupSent: Boolean(followUp?.followup_sent || followUp?.follow_up_sent_at),
      followupSentAt: followUp?.follow_up_sent_at ?? null,
      emailSubject: followUp?.email_subject ?? null,
      emailBody: followUp?.email_body ?? null,
      converted: user ? user.plan !== 'free' : false,
    })
  }

  return [...rowsByEmail.values()].sort(
    (a, b) => new Date(b.captureDate).getTime() - new Date(a.captureDate).getTime()
  )
}

export default async function AdminLeadCapturePage() {
  const profile = await getUserProfile()

  if (!isAdmin(profile)) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()
  const { data: settingsData } = await (admin.from('follow_up_settings' as never) as any)
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const settings = getEffectiveFollowUpSettings((settingsData || null) as FollowUpSettingsRow | null)

  const { data: activityLogsData } = await admin
    .from('activity_logs')
    .select('id, session_id, user_id, email, event, query, location, leads_count, metadata, created_at')
    .eq('event', 'email_export_sent')
    .order('created_at', { ascending: false })
    .limit(10000)

  const activityLogs = (activityLogsData || []) as ActivityLogRow[]
  const userIds = [...new Set(activityLogs.map((row) => row.user_id).filter(Boolean))] as string[]

  const [{ data: usersData }, { data: followUpsData }] = await Promise.all([
    userIds.length
      ? admin.from('users').select('id, email, plan, created_at').in('id', userIds)
      : Promise.resolve({ data: [] as UserRow[] }),
    (admin.from('lead_follow_ups' as never) as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000),
  ])

  const initialSettings = {
    follow_up_delay_days: settings.follow_up_delay_days ?? DEFAULT_FOLLOW_UP_SETTINGS.follow_up_delay_days,
    coupon_code: settings.coupon_code,
    discount_label: settings.discount_label,
    email_subject: settings.email_subject,
    email_body_template: settings.email_body_template,
    send_copy_to_admin: settings.send_copy_to_admin,
    admin_notification_email:
      settings.admin_notification_email || process.env.ADMIN_EMAIL || DEFAULT_FOLLOW_UP_SETTINGS.admin_notification_email,
    exclusion_patterns: settings.exclusion_patterns || DEFAULT_FOLLOW_UP_SETTINGS.exclusion_patterns,
  }

  return (
    <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>
      <LeadFollowUpsAdmin
        initialRows={buildRows({
          logs: activityLogs,
          users: (usersData || []) as UserRow[],
          followUps: (followUpsData || []) as LeadFollowUpRow[],
          delayDays: initialSettings.follow_up_delay_days,
          exclusionPatterns: initialSettings.exclusion_patterns,
        })}
        initialSettings={initialSettings}
      />
    </DashboardShell>
  )
}
