import { redirect } from 'next/navigation'

import AdminGrowthDashboard from '@/components/admin/AdminGrowthDashboard'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

type ActivityLogRow = Database['public']['Tables']['activity_logs']['Row']
type UserRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'email' | 'plan' | 'created_at'>

export default async function AdminActivityPage() {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const profile = await getUserProfile()

  if (!profile?.email || profile.email.toLowerCase() !== adminEmail) {
    redirect('/dashboard')
  }

  const admin = createAdminClient()
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: activityLogsData } = await admin
    .from('activity_logs')
    .select('id, session_id, user_id, email, event, query, location, leads_count, metadata, created_at')
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(5000)

  const activityLogs = (activityLogsData || []) as ActivityLogRow[]

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
      <AdminGrowthDashboard initialLogs={activityLogs} users={users} />
    </DashboardShell>
  )
}
