import { redirect } from 'next/navigation'

import AdminGrowthDashboard from '@/components/admin/AdminGrowthDashboard'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { getEffectiveFollowUpSettings, type FollowUpSettingsRow, type LeadFollowUpRow } from '@/lib/admin/lead-follow-ups'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

type ActivityLogRow = Database['public']['Tables']['activity_logs']['Row']
type UserRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'email' | 'plan' | 'created_at'>

export default async function AdminActivityPage() {
  const profile = await getUserProfile()

  if (!isAdmin(profile)) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()
  const [{ data: activityLogsData }, { data: followUpsData }, { data: settingsData }] = await Promise.all([
    admin
      .from('activity_logs')
      .select('id, session_id, user_id, email, event, query, location, leads_count, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    (admin.from('lead_follow_ups' as never) as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000),
    (admin.from('follow_up_settings' as never) as any)
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  const activityLogs = (activityLogsData || []) as ActivityLogRow[]
  const settings = getEffectiveFollowUpSettings((settingsData || null) as FollowUpSettingsRow | null)

  const userIds = [...new Set(activityLogs.map((row) => row.user_id).filter(Boolean))] as string[]

  const { data: usersData } = userIds.length
    ? await admin
        .from('users')
        .select('id, email, plan, created_at')
        .in('id', userIds)
    : { data: [] }

  const users = (usersData || []) as UserRow[]

  return (
    <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>
      <AdminGrowthDashboard
        initialLogs={activityLogs}
        users={users}
        followUps={(followUpsData || []) as LeadFollowUpRow[]}
        delayDays={settings.follow_up_delay_days}
      />
    </DashboardShell>
  )
}
