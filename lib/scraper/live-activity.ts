// Customer-facing wording for the live activity feed. Shared by the real Discover page and the
// local replay studio so both describe events identically. It only translates lines that the
// stream actually sent; it never invents activity, and it avoids provider and database jargon.

export function isHiddenSystemLog(msg: string) {
  return msg.includes('api cost estimate') || msg.includes('SCRAPER API COST')
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function getLogName(msg: string, prefix: string) {
  return msg.slice(prefix.length).split('|')[0].trim()
}

export type LiveActivityItem = {
  label: string
  detail?: string
  tone?: 'default' | 'success' | 'warning' | 'error'
}

export function formatLiveActivity(msg: string): LiveActivityItem | null {
  if (!msg || isHiddenSystemLog(msg) || msg === '🟢 stream started') return null

  if (msg.startsWith('✓ ')) {
    return { label: 'Found', detail: getLogName(msg, '✓ '), tone: 'success' }
  }

  if (msg.startsWith('🔎 ')) {
    return { label: 'Searching', detail: getLogName(msg, '🔎 ') }
  }

  if (msg === '🛰️ Serper priority pass') {
    return { label: 'Searching map results' }
  }

  if (msg.startsWith('🛰️ Google improvement pass')) {
    return { label: 'Searching additional sources' }
  }

  if (msg.startsWith('📥 ')) {
    return { label: 'Found', detail: getLogName(msg, '📥 '), tone: 'success' }
  }

  if (msg.startsWith('🔬 ')) {
    return { label: 'Checking website', detail: getLogName(msg, '🔬 ') }
  }

  if (msg.startsWith('✨ ')) {
    return { label: 'Email found', detail: getLogName(msg, '✨ '), tone: 'success' }
  }

  if (msg.startsWith('⛔ no website: ')) {
    return { label: 'No website found', detail: getLogName(msg, '⛔ no website: '), tone: 'warning' }
  }

  if (msg.startsWith('⛔ no email: ')) {
    return { label: 'No email found', detail: getLogName(msg, '⛔ no email: '), tone: 'warning' }
  }

  if (msg.startsWith('🧩 improved ')) {
    return { label: 'Lead improved', detail: getLogName(msg, '🧩 improved '), tone: 'success' }
  }

  const discoveredMatch = msg.match(/^📦 discovered: (\d+)/)
  if (discoveredMatch) {
    return {
      label: 'Businesses discovered',
      detail: pluralize(Number(discoveredMatch[1]), 'business', 'businesses'),
      tone: 'success',
    }
  }

  const enrichedMatch = msg.match(/^📦 enriched: (\d+)/)
  if (enrichedMatch) {
    return { label: 'Contact details found', detail: `${pluralize(Number(enrichedMatch[1]), 'business', 'businesses')} with an email or phone`, tone: 'success' }
  }

  const metricsMatch = msg.match(/^📊(?: improved)? websites: (\d+), valid emails: (\d+), enrichment rate: ([\d.]+%?)/)
  if (metricsMatch) {
    return {
      label: 'Website check summary',
      detail: `${metricsMatch[1]} websites checked, ${metricsMatch[2]} emails found`,
      tone: 'success',
    }
  }

  const savedMatch = msg.match(/^💾 saved: (\d+), duplicates: (\d+), invalid: (\d+), db errors: (\d+)/)
  if (savedMatch) {
    return {
      label: 'Added to My Leads',
      detail: `${savedMatch[1]} saved, ${savedMatch[2]} duplicates removed, ${savedMatch[3]} invalid filtered`,
      tone: 'success',
    }
  }

  if (msg.startsWith('⚠️ duplicate skipped: ')) {
    return { label: 'Duplicate removed', detail: getLogName(msg, '⚠️ duplicate skipped: '), tone: 'warning' }
  }

  if (msg.startsWith('⚠️ invalid lead skipped: ')) {
    return { label: 'Invalid business filtered', detail: getLogName(msg, '⚠️ invalid lead skipped: '), tone: 'warning' }
  }

  const filteredMatch = msg.match(/^Filtered out (\d+) leads without contact info/)
  if (filteredMatch) {
    return {
      label: 'Invalid businesses filtered',
      detail: pluralize(Number(filteredMatch[1]), 'lead'),
      tone: 'warning',
    }
  }

  if (msg === '⚡ Improving results with Google...') {
    return { label: 'Searching additional sources' }
  }

  if (msg === '✅ early stop: enrichment target reached') {
    return { label: 'Quality target reached', tone: 'success' }
  }

  if (msg === '✅ Serper satisfied quality targets') {
    return { label: 'Quality target satisfied', tone: 'success' }
  }

  if (msg.includes('🛑 Mission aborted')) return { label: 'Search stopped', tone: 'warning' }
  if (msg.includes('🎉 Prospecting complete')) return { label: 'Finalizing results', tone: 'success' }
  if (msg.startsWith('❌')) return { label: msg.replace(/^❌\s*/, ''), tone: 'error' }

  return null
}

/**
 * Turns the raw log lines received so far into the customer-facing activity list: only lines
 * with a translation, consecutive repeats collapsed, newest last.
 */
export function buildActivityItems(logs: string[], limit = 25): LiveActivityItem[] {
  return logs
    .map((entry) => formatLiveActivity(entry))
    .filter((entry): entry is LiveActivityItem => Boolean(entry))
    .filter((entry, index, entries) => {
      const previous = entries[index - 1]
      return !previous || entry.label !== previous.label || entry.detail !== previous.detail
    })
    .slice(-limit)
}
