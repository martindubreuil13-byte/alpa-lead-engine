import type { TrialLead } from '@/lib/trial'

type CsvLead = Pick<
  TrialLead,
  'company_name' | 'email' | 'phone' | 'website' | 'city'
>

export function buildLeadCsv(leads: CsvLead[]) {
  const headers = ['Business Name', 'Email', 'Phone', 'Website', 'Location']
  const rows = leads.map((lead) => [
    lead.company_name,
    lead.email || '',
    lead.phone || '',
    lead.website || '',
    lead.city || '',
  ])

  return [headers, ...rows]
    .map((row) =>
      row
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n')
}
