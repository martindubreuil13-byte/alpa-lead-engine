// Language-independent checks that a generated summary did not add hard facts the website text does not contain.
//
// Deliberately NOT a word-overlap test: ALPA researches websites in several languages (many are French) while the summary is
// written in English, so overlap would reject honest translations. A calibration against the 105 profiles in production showed
// 4 of 105 would have been wrongly refused at a 50% overlap threshold. Figures, web addresses and email addresses are checked
// instead, because they read the same in every language and are the claims most damaging when invented.

export type GroundingProblem = 'unsupported_figure' | 'unsupported_address'

const collapseDigits = (value: string) => value.replace(/(?<=\d)[\s,.  '’](?=\d)/g, '')

/** Numbers in a text with thousands and decimal separators removed, so "4,500", "4 500" and "4500" are the same figure. */
export function figuresIn(text: string): string[] {
  return [...collapseDigits(text).matchAll(/\d+/g)].map((match) => match[0])
}

/** The first thing in `summary` that the evidence does not support, or null when it stays within the evidence. */
export function findUnsupportedClaim(summary: string, evidence: string): GroundingProblem | null {
  const known = collapseDigits(evidence)
  const knownFigures = new Set(figuresIn(known))
  // A one-digit figure is normally a spelled-out count ("3 locations"); only multi-digit figures are treated as hard facts.
  if (figuresIn(summary).some((figure) => figure.length > 1 && !knownFigures.has(figure) && !known.includes(figure))) return 'unsupported_figure'

  const lower = evidence.toLowerCase()
  const addresses = summary.match(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.-]+/gi) ?? []
  if (addresses.some((address) => !lower.includes(address.toLowerCase().replace(/[.,;)]+$/, '')))) return 'unsupported_address'
  return null
}
