import { redirect } from 'next/navigation'

import AgentWorkspace from '@/components/agent/AgentWorkspace'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import type { ICPData } from '@/lib/ai/icp'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type SavedIcpRecord = {
  id: string
  data: ICPData
  isActive: boolean
  status: string
  createdAt: string
}

type AgentMissionRecord = {
  id: string
  name: string | null
  status: string
  leadsPerDay: number
  contactMode: string
  location: string
}

function mapStoredIcp(structuredOutput: unknown): ICPData | null {
  if (!structuredOutput || typeof structuredOutput !== 'object') {
    return null
  }

  const value = structuredOutput as Record<string, unknown>
  const targetBusinesses = Array.isArray(value.target_businesses)
    ? value.target_businesses.filter((item): item is string => typeof item === 'string')
    : []
  const locations = Array.isArray(value.locations)
    ? value.locations.filter((item): item is string => typeof item === 'string')
    : []
  const painPoints = Array.isArray(value.pain_points)
    ? value.pain_points.filter((item): item is string => typeof item === 'string')
    : []
  const messagingAngles = Array.isArray(value.messaging_angles)
    ? value.messaging_angles.filter((item): item is string => typeof item === 'string')
    : []
  const summary = typeof value.summary === 'string' ? value.summary : ''

  if (targetBusinesses.length === 0 || painPoints.length === 0 || messagingAngles.length === 0 || !summary) {
    return null
  }

  return {
    industries: targetBusinesses,
    excluded: [],
    location: locations,
    company_size: '',
    pain_points: painPoints,
    angles: messagingAngles,
    summary,
  }
}

function mapStoredIcpRecord(row: {
  id: string
  structured_output: unknown
  is_active: boolean
  status: string
  created_at: string
}): SavedIcpRecord | null {
  const data = mapStoredIcp(row.structured_output)

  if (!data) return null

  return {
    id: row.id,
    data,
    isActive: row.is_active,
    status: row.status,
    createdAt: row.created_at,
  }
}

export default async function AgentModePage() {
  const user = await getUserProfile()

  if (!user || !isAdmin(user)) {
    redirect('/')
  }

  const supabase = await createServerClient()
  const [{ data: savedIcpRows }, { data: missionRows }] = await Promise.all([
    supabase
      .from('agent_icp')
      .select('id, structured_output, is_active, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('agent_missions')
      .select('id, name, status, leads_per_day, contact_mode, location')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const initialSavedIcps: SavedIcpRecord[] = (savedIcpRows ?? [])
    .map(mapStoredIcpRecord)
    .filter((row): row is SavedIcpRecord => Boolean(row))
  const initialActiveIcp: SavedIcpRecord | null =
    initialSavedIcps.find((icp) => icp.isActive) ?? null

  const initialMissions: AgentMissionRecord[] = (missionRows ?? []).map((mission) => ({
    id: mission.id,
    name: mission.name,
    status: mission.status,
    leadsPerDay: mission.leads_per_day,
    contactMode: mission.contact_mode,
    location: mission.location,
  }))

  const initialActiveMission =
    initialMissions.find((mission) => mission.status === 'active') ?? initialMissions[0] ?? null
  const agentStatusText = initialActiveMission
    ? 'Mission configured. Ready to run...'
    : initialActiveIcp
      ? 'Target locked. Ready for mission...'
      : 'Agent standing by...'
  const agentStatusTone = initialActiveMission
    ? 'bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.7)]'
    : initialActiveIcp
      ? 'bg-blue-300 shadow-[0_0_18px_rgba(96,165,250,0.7)]'
      : 'bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.65)]'
  const workspaceSnapshotKey = JSON.stringify({
    savedIcps: initialSavedIcps.map((icp) => ({
      id: icp.id,
      isActive: icp.isActive,
      status: icp.status,
    })),
    activeIcpId: initialActiveIcp?.id ?? null,
    missions: initialMissions.map((mission) => ({
      id: mission.id,
      name: mission.name,
      status: mission.status,
    })),
    activeMissionId: initialActiveMission?.id ?? null,
  })

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 pb-4">
        <header className="glass relative overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-0 z-0">
            <div className="agent-breath agent-drift absolute left-[22%] top-[46%] h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_45%_50%,rgba(34,197,94,0.22),rgba(59,130,246,0.21)_38%,rgba(6,182,212,0.13)_56%,transparent_78%)] blur-[108px] sm:h-[460px] sm:w-[460px]" />
            <div className="agent-breath-soft agent-drift-soft absolute right-[2%] top-[12%] h-[310px] w-[310px] rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(45,212,191,0.15),rgba(34,211,238,0.12)_44%,transparent_74%)] blur-[104px] sm:h-[380px] sm:w-[380px]" />
            <div className="agent-sweep absolute inset-y-[-26%] left-[-20%] w-[62%] rotate-[14deg] bg-[linear-gradient(90deg,transparent,rgba(125,211,252,0.08),rgba(59,130,246,0.16),rgba(45,212,191,0.11),transparent)] blur-[42px]" />
            <div className="agent-grid-shift absolute inset-0 opacity-[0.11] [background-image:linear-gradient(rgba(148,163,184,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.13)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(180deg,rgba(0,0,0,0.76),transparent_92%)]" />
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/18 to-transparent" />
          </div>

          <div className="relative z-10 space-y-3">
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

            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/8 bg-[linear-gradient(90deg,rgba(8,15,29,0.9),rgba(8,15,29,0.65))] px-3 py-2.5 shadow-[0_10px_30px_rgba(2,8,23,0.18)] sm:px-4">
              <div className="relative flex h-3 w-3 items-center justify-center">
                <span className="absolute inline-flex h-3 w-3 rounded-full bg-white/10 animate-pulse" />
                <span className={`relative h-2 w-2 rounded-full ${agentStatusTone}`} />
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">
                Agent Status
              </div>
              <div className="hidden h-px flex-1 bg-gradient-to-r from-white/12 via-white/8 to-transparent sm:block" />
              <div className="text-sm font-medium text-slate-200">{agentStatusText}</div>
            </div>
          </div>
        </header>

        <AgentWorkspace
          key={workspaceSnapshotKey}
          initialSavedIcps={initialSavedIcps}
          initialActiveIcp={initialActiveIcp}
          initialMissions={initialMissions}
          initialActiveMission={initialActiveMission}
        />
      </div>
    </DashboardShell>
  )
}
