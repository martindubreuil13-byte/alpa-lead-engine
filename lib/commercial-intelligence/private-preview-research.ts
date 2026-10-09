import type { TrialLead } from '@/lib/trial'

export type PrivatePreviewResearchStatus = 'researching' | 'ready' | 'unavailable'

export function getPrivatePreviewResearchStatus(
  lead: Pick<TrialLead, 'commercial_profile' | 'ci_enrichment_status'>
): PrivatePreviewResearchStatus {
  if (lead.commercial_profile?.summary?.trim()) return 'ready'

  if (['failed', 'skipped', 'completed'].includes(lead.ci_enrichment_status || '')) {
    return 'unavailable'
  }

  return 'researching'
}

export function shouldRefreshPrivatePreviewResearch(leads: TrialLead[]) {
  return leads.some((lead) => getPrivatePreviewResearchStatus(lead) === 'researching')
}

export function mergePrivatePreviewResearch(
  leads: TrialLead[],
  updates: Array<
    Pick<
      TrialLead,
      'id' | 'commercial_profile' | 'ci_enrichment_status' | 'ci_completed_at' | 'ci_last_error'
    >
  >
) {
  const updatesById = new Map(updates.map((lead) => [lead.id, lead]))
  return leads.map((lead) => {
    const update = updatesById.get(lead.id)
    return update ? { ...lead, ...update } : lead
  })
}
