import { redirect } from 'next/navigation'

import AgentInsightPanel from '@/components/agent/AgentInsightPanel'
import ICPInput from '@/components/agent/ICPInput'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const dynamic = 'force-dynamic'

export default async function AgentModePage() {
  const user = await getUserProfile()

  if (!user || !isAdmin(user)) {
    redirect('/')
  }

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 pb-4">
        <header className="glass overflow-hidden p-5 sm:p-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100 shadow-[0_0_24px_rgba(59,130,246,0.18)]">
              <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
              Agent Lab
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Agent Mode
              </h1>
              <p className="max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                Build and deploy your autonomous lead engine
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="min-w-0">
            <ICPInput />
          </div>

          <div className="hidden lg:block">
            <AgentInsightPanel />
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
