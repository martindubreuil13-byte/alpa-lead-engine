export type DiscoveryStopReason = 'target_reached' | 'search_limit' | 'cost_limit' | 'provider_error'

/** Explains an actual returned-result shortfall without claiming the sources were exhausted. */
export function describeSearchShortfall(input: {
  requested: number
  added: number
  outputLimit: number
  stopReason: DiscoveryStopReason
  duplicates: number
  invalid: number
  failed: number
  withoutContact: number
  irrelevant?: number
}): string | null {
  if (input.added >= input.requested) return null
  const parts = [`${input.added} of ${input.requested} requested businesses added to your results.`]
  if (input.outputLimit < input.requested && input.added >= input.outputLimit) {
    parts.push('Your remaining lead allowance limited the results.')
  }
  if (input.stopReason === 'search_limit') parts.push('The search reached its current limit.')
  if (input.stopReason === 'cost_limit') parts.push('The search reached its cost limit.')
  if (input.stopReason === 'provider_error') parts.push('A business source could not complete its search.')
  if (input.irrelevant) parts.push(`${input.irrelevant} source results had a different business category.`)
  if (input.duplicates) parts.push(`${input.duplicates} ${input.duplicates === 1 ? 'business was' : 'businesses were'} already saved.`)
  if (input.withoutContact) parts.push(`${input.withoutContact} ${input.withoutContact === 1 ? 'business had' : 'businesses had'} no usable contact details.`)
  if (input.invalid) parts.push(`${input.invalid} ${input.invalid === 1 ? 'result was' : 'results were'} missing required details.`)
  if (input.failed) parts.push(`${input.failed} ${input.failed === 1 ? 'business could' : 'businesses could'} not be saved.`)
  return parts.join(' ')
}
