import type { ResultRowModel } from '../scraper/results-summary.ts'
import { ROW_LABEL, type ProfileCard, type ProfileReason, type ProfileState } from './run-progress.ts'

export type RowProgress = { leadId: string; state: ProfileState; reason: ProfileReason }

/**
 * Adds the real profile state (and the profile, once ready) to each result row. Rows the server has no state for are
 * returned unchanged, so a search with no authorized run looks exactly as it did before. A ready profile shows its own
 * summary inside the profile block, so the older one-line synopsis is dropped for that row.
 */
export function withIntelligence(rows: ResultRowModel[], progress: RowProgress[] | null | undefined, profiles: Record<string, ProfileCard> | null | undefined, retryable: string[] = []): ResultRowModel[] {
  if (!progress || progress.length === 0) return rows
  const byLead = new Map(progress.map((row) => [row.leadId, row]))
  return rows.map((row) => {
    const state = byLead.get(row.id)
    if (!state) return row
    const card = profiles?.[row.id] ?? null
    return { ...row, synopsis: card ? null : row.synopsis, intelligence: { state: state.state, label: ROW_LABEL[state.state], reason: state.reason, card, retryable: retryable.includes(row.id) } }
  })
}
