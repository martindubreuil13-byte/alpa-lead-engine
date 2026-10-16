import { redirect } from 'next/navigation'

import CostDashboard from '@/components/admin/CostDashboard'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const dynamic = 'force-dynamic'

export default async function AdminCostsPage() {
  const profile = await getUserProfile()

  if (!isAdmin(profile)) {
    redirect('/dashboard')
  }

  return (
    <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>
      <CostDashboard />
    </DashboardShell>
  )
}
