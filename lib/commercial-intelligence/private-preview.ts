export function isPrivatePreviewWorkerRequest(
  requested: boolean,
  userId: string | null | undefined,
  ownerUserId: string | null | undefined
) {
  const ownerId = ownerUserId?.trim()
  return requested && Boolean(userId) && Boolean(ownerId) && userId === ownerId
}

type RediscoveryCandidate = {
  website?: string | null
  email?: string | null
  company_name?: string | null
  city?: string | null
}

/**
 * Finds the owner's existing lead for a business that a private-preview search
 * rediscovered. Scoped to the owner's own leads and to the single business
 * returned by the current search, so unrelated historical leads are never touched.
 */
export async function findExistingOwnerLeadId(
  client: any,
  userId: string,
  lead: RediscoveryCandidate
): Promise<string | null> {
  const attempts: Array<Record<string, string>> = []
  if (lead.website) attempts.push({ website: lead.website })
  if (lead.email) attempts.push({ email: lead.email })
  if (lead.company_name) {
    attempts.push(lead.city ? { company_name: lead.company_name, city: lead.city } : { company_name: lead.company_name })
  }

  for (const filters of attempts) {
    let query = client.from('leads').select('id').eq('user_id', userId)
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value)
    const { data, error } = await query.limit(1)
    if (!error && data?.[0]?.id) return data[0].id as string
  }
  return null
}
