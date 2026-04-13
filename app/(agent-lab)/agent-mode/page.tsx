import { redirect } from 'next/navigation'

import AgentWorkspace from '@/components/agent/AgentWorkspace'
import ICPInput from '@/components/agent/ICPInput'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import type { ICPData } from '@/lib/ai/icp'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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

  const supabase = await createSupabaseServerClient()
  const { data: savedIcpRows } = await supabase
    .from('agent_icp')
    .select('id, structured_output, is_active, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const initialSavedIcps = (savedIcpRows || [])
    .map(mapStoredIcpRecord)
    .filter((row): row is SavedIcpRecord => Boolean(row))
  const activeIcp = initialSavedIcps.find((icp) => icp.isActive) ?? null

  const { data: missionRows } = await supabase
    .from('agent_missions')
    .select('id, name, status, leads_per_day, contact_mode, location')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const missions: AgentMissionRecord[] = (missionRows || []).map((mission) => ({
    id: mission.id,
    name: mission.name,
    status: mission.status,
    leadsPerDay: mission.leads_per_day,
    contactMode: mission.contact_mode,
    location: mission.location,
  }))

  const activeMission = missions.find((mission) => mission.status === 'active') ?? missions[0] ?? null

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

        <AgentWorkspace
          initialSavedIcps={initialSavedIcps}
          activeIcp={activeIcp}
          activeMission={activeMission}
        />
      </div>
    </DashboardShell>
  )
}
