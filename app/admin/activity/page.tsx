import { redirect } from 'next/navigation'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function formatTimestamp(value: string | null) {
  if (!value) return 'Unknown'

  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function shortenSessionId(value: string | null) {
  const normalized = String(value || '').trim()
  if (!normalized) return 'unknown'
  return normalized.slice(0, 8)
}

export default async function AdminActivityPage() {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email || user.email.toLowerCase() !== adminEmail) {
    redirect('/dashboard')
  }

  const { data: activityLogs } = await supabase
    .from('activity_logs')
    .select('created_at, email, event, query, leads_count, session_id')
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <DashboardShell adminEmail={process.env.ADMIN_EMAIL || null}>
      <div className="space-y-6">
        <header className="glass p-5 sm:p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/80">
            Admin
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Activity
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Latest product activity across anonymous and authenticated sessions.
          </p>
        </header>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_24px_80px_rgba(2,8,23,0.32)]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Query</th>
                  <th className="px-4 py-3 font-medium">Leads</th>
                  <th className="px-4 py-3 font-medium">Session ID</th>
                </tr>
              </thead>
              <tbody>
                {(activityLogs || []).map((row, index) => (
                  <tr
                    key={`${row.session_id}-${row.created_at}-${index}`}
                    className="border-t border-white/6"
                  >
                    <td className="px-4 py-3 text-slate-400">{formatTimestamp(row.created_at)}</td>
                    <td className="px-4 py-3">{row.email || 'anonymous'}</td>
                    <td className="px-4 py-3 text-white">{row.event}</td>
                    <td className="px-4 py-3 text-slate-400">{row.query || '—'}</td>
                    <td className="px-4 py-3">{row.leads_count ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {shortenSessionId(row.session_id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
