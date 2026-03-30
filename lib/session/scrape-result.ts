const SCRAPE_RESULT_STORAGE_KEY = 'alpa_latest_scrape_result'

export type StoredScrapeResult = {
  totalFoundLeads: number
  savedLeads: number
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function readStoredScrapeResult(): StoredScrapeResult | null {
  if (!canUseStorage()) return null

  const raw = window.sessionStorage.getItem(SCRAPE_RESULT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredScrapeResult>
    if (
      typeof parsed.totalFoundLeads === 'number' &&
      typeof parsed.savedLeads === 'number'
    ) {
      return {
        totalFoundLeads: parsed.totalFoundLeads,
        savedLeads: parsed.savedLeads,
      }
    }
  } catch {}

  return null
}

export function writeStoredScrapeResult(result: StoredScrapeResult) {
  if (!canUseStorage()) return
  window.sessionStorage.setItem(SCRAPE_RESULT_STORAGE_KEY, JSON.stringify(result))
}
