import type { TrialLead } from '@/lib/trial'

type CsvLead = Pick<TrialLead, 'company_name' | 'email' | 'phone' | 'city'> & {
  website?: string | null
  commercial_profile?: any | null
  ci_completed_at?: string | null
}

function formatCsvValue(value: any): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.join('; ')
    }
    return JSON.stringify(value)
  }
  return String(value)
}

export function buildLeadCsv(leads: CsvLead[]) {
  const headers = [
    'Business Name',
    'Email',
    'Phone',
    'Website',
    'Location',
    'Business Summary',
    'Industry',
    'Primary Service',
    'Target Customer',
    'Core Services',
    'Keywords',
    'Last Refreshed',
  ]

  const rows = leads.map((lead) => {
    const profile = lead.commercial_profile || null
    const lastRefreshed = lead.ci_completed_at
      ? new Date(lead.ci_completed_at).toLocaleDateString()
      : ''

    return [
      lead.company_name,
      lead.email || '',
      lead.phone || '',
      lead.website || '',
      lead.city || '',
      formatCsvValue(profile?.summary || ''),
      formatCsvValue(profile?.industry || ''),
      formatCsvValue(profile?.primary_service || ''),
      formatCsvValue(profile?.target_customer || ''),
      formatCsvValue(profile?.core_services || []),
      formatCsvValue(profile?.keywords || []),
      lastRefreshed,
    ]
  })

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
