import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Zap } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AgentEntryPage() {
  const profile = await getUserProfile()

  if (!profile || !isAdmin(profile)) {
    redirect('/dashboard')
  }

  const supabase = await createServerClient()

  const { data: missions } = await supabase
    .from('agent_missions')
    .select('id, status, created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(1)

  const latest = missions?.[0] ?? null

  if (latest) {
    redirect(`/agent/dashboard/${latest.id}`)
  }

  // No missions yet — show empty state
  return (
    <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>
      <div className="flex min-h-[76vh] flex-col items-center justify-center px-4">
        <div className="relative w-full max-w-md text-center">
          {/* Ambient glow */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.12),transparent_68%)] blur-[80px]" />

          <div className="relative space-y-6">
            {/* Icon */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-blue-400/20 bg-blue-500/10 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
              <Zap className="h-7 w-7 text-blue-300" />
            </div>

            {/* Copy */}
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white">
                Give me a mission
              </h1>
              <p className="text-base text-slate-400">
                Tell me what you want. I'll handle the rest.
              </p>
            </div>

            {/* CTA */}
            <Link
              href="/agent/setup"
              className="inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/12 px-6 py-3.5 text-sm font-semibold text-blue-100 shadow-[0_0_28px_rgba(59,130,246,0.18)] transition hover:bg-blue-500/20 hover:text-white"
            >
              <Zap className="h-4 w-4" />
              Create Mission
            </Link>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
