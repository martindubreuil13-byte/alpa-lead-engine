import LeadsPageClient from './LeadsPageClient'

import {
  mapMissionQueueRowsToInboxLeads,
  type MissionInboxLead,
} from '@/lib/leads/mission-leads'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type LeadsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() || ''
  }

  return String(value || '').trim()
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const missionIdFilter = readSearchParam(resolvedSearchParams.mission_id)

  let initialMissionLeads: MissionInboxLead[] = []
  let missionQueryError: string | null = null

  if (missionIdFilter) {
    const supabase = await createServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      missionQueryError = userError?.message || 'You must be signed in to view mission leads.'
      console.info('[dashboard/leads] mission query', {
        mission_id: missionIdFilter,
        row_count: 0,
      })
    } else {
      const { data, error } = await supabase
        .from('agent_lead_queue')
        .select(
          'id, user_id, mission_id, business_name, website, email, phone, location, qualification_status, created_at'
        )
        .eq('user_id', user.id)
        .eq('mission_id', missionIdFilter)
        .order('created_at', { ascending: false })

      if (error) {
        missionQueryError = error.message
        console.error('[dashboard/leads] mission query failed', {
          mission_id: missionIdFilter,
          message: error.message,
        })
      } else {
        initialMissionLeads = mapMissionQueueRowsToInboxLeads(data || [])
      }

      console.info('[dashboard/leads] mission query', {
        mission_id: missionIdFilter,
        row_count: initialMissionLeads.length,
      })
    }
  }

  return (
    <LeadsPageClient
      missionIdFilter={missionIdFilter || null}
      initialMissionLeads={initialMissionLeads}
      missionQueryError={missionQueryError}
    />
  )
}
