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
type UserRow = Pick<
  Database['public']['Tables']['users']['Row'],
  | 'id'
  | 'email'
  | 'plan'
  | 'role'
  | 'created_at'
  | 'subscription_status'
  | 'plan_status'
  | 'subscription_tier'
  | 'subscription_active'
  | 'analytics_excluded'
  | 'signup_date'
  | 'first_search_date'
  | 'first_export_date'
  | 'first_upgrade_click_date'
  | 'paid_conversion_date'
>

export default async function AdminActivityPage() {
  const profile = await getUserProfile()

  if (!isAdmin(profile)) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()
  const [
    { data: activityLogsData },
    { data: followUpsData },
    { data: settingsData },
    { data: usersData },
    { data: searchAnalyticsData },
    { data: attributionData },
  ] = await Promise.all([
    admin
      .from('activity_logs')
      .select('*')
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
    admin
      .from('users')
      .select('id, email, role, plan, subscription_status, plan_status, subscription_tier, subscription_active, analytics_excluded, signup_date, first_search_date, first_export_date, first_upgrade_click_date, paid_conversion_date, created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    (admin.from('search_analytics' as never) as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000),
    (admin.from('user_attribution' as never) as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000),
  ])

  const activityLogs = (activityLogsData || []) as ActivityLogRow[]
  const settings = getEffectiveFollowUpSettings((settingsData || null) as FollowUpSettingsRow | null)

  const users = (usersData || []) as UserRow[]

  return (
    <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>
      <AdminGrowthDashboard
        initialLogs={activityLogs}
        users={users}
        searches={(searchAnalyticsData || []) as Database['public']['Tables']['search_analytics']['Row'][]}
        attribution={(attributionData || []) as Database['public']['Tables']['user_attribution']['Row'][]}
        followUps={(followUpsData || []) as LeadFollowUpRow[]}
        delayDays={settings.follow_up_delay_days}
      />
    </DashboardShell>
  )
}
