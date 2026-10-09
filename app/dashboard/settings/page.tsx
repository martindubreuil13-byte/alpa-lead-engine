import { redirect } from 'next/navigation'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

import SenderSettingsPanel from './SenderSettingsPanel'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  // Sender/email configuration is retired for customers; administrators keep it.
  // Customer account details live on Plan & Billing, so Settings is redundant for them.
  if (!isAdmin(profile)) redirect('/dashboard/billing')

  return <SenderSettingsPanel />
}
