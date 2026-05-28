import type { TrialLead } from '@/lib/trial'

type CsvLead = Pick<TrialLead, 'company_name' | 'email' | 'phone' | 'city'> & {
  website?: string | null
}

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

export function getLeadCsvFilename(prefix = 'alpa-leads') {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('')

  return `${prefix}-${date}-${time}.csv`
}

export function downloadLeadCsv(leads: CsvLead[], filename = getLeadCsvFilename()) {
  const csv = buildLeadCsv(leads)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
