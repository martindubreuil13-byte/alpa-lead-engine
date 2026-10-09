import Link from 'next/link'
import { redirect } from 'next/navigation'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

import SenderSettingsPanel from './SenderSettingsPanel'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  // Sender/email configuration is retired for customers; administrators keep it.
  if (isAdmin(profile)) return <SenderSettingsPanel />

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="glass p-5 sm:p-6">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Settings</h1>
        <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">
          Your ALPA account details.
        </p>
      </header>

      <section className="glass space-y-4 p-5 sm:p-6">
        <div>
          <div className="text-sm text-slate-400">Email</div>
          <div className="text-base font-medium text-white">{profile.email}</div>
        </div>
        <div>
          <div className="text-sm text-slate-400">Plan</div>
          <div className="text-base font-medium capitalize text-white">{profile.plan}</div>
        </div>
        <Link href="/dashboard/billing" className="btn-secondary inline-flex">
          Manage plan &amp; billing
        </Link>
      </section>
    </div>
  )
}
