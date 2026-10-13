// What a visitor is told after their free-trial businesses were brought into their new account. Honest in both directions: it says
// how many are in My Leads, and when a free account had no room for the rest it says that too, and where they still are. A
// business is never left out silently while the page implies everything was saved.

export type ClaimOutcome = { imported: number; skipped_invalid: number; skipped_duplicate: number; skipped_allowance?: number }

export type ClaimNotice = {
  tone: 'info' | 'attention'
  title: string
  body: string
  /** The trial results page, where the businesses that did not fit are still available. */
  showTrialLink: boolean
  showPlansLink: boolean
}

export function describeClaimNotice(result: ClaimOutcome | null | undefined): ClaimNotice | null {
  if (!result) return null
  const left = Math.max(0, result.skipped_allowance ?? 0)
  const inLibrary = Math.max(0, result.imported) + Math.max(0, result.skipped_duplicate)
  const total = inLibrary + left + Math.max(0, result.skipped_invalid)

  if (left > 0) {
    return {
      tone: 'attention',
      title: inLibrary > 0 ? `We saved ${inLibrary} of your ${total} free-trial businesses to My Leads.` : 'None of your free-trial businesses could be added to My Leads.',
      body: `A free account holds up to 25 businesses, so ${left} ${left === 1 ? 'was' : 'were'} not added. ${left === 1 ? 'It is' : 'They are'} still on your free trial page until that expires, and a plan makes room for more.`,
      showTrialLink: true,
      showPlansLink: true,
    }
  }
  if (result.imported > 0) {
    return {
      tone: 'info',
      title: `${result.imported} of your free-trial ${result.imported === 1 ? 'business is' : 'businesses are'} saved in My Leads.`,
      body: 'They came across with what ALPA found on their websites.',
      showTrialLink: false,
      showPlansLink: false,
    }
  }
  return null
}
