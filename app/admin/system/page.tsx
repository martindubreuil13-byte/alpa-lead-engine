import { redirect } from 'next/navigation'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const dynamic = 'force-dynamic'

export default async function AdminSystemPage() {
  const profile = await getUserProfile()

  if (!isAdmin(profile)) {
    redirect('/dashboard')
  }

  return (
    <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>
      <div className="rounded-[28px] bg-white/[0.04] p-7 shadow-[0_24px_80px_rgba(2,8,23,0.22)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/80">
          Admin
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">System</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          System administration will live here.
        </p>
      </div>
    </DashboardShell>
  )
}
