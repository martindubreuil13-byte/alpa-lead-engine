// What a person is told about Business Intelligence (automatic business profiles) for their account, in one place.
//
//   guest           short profiles are written when a business is opened ("Ready to explore")
//   free member     automatic profiles are a paid-plan feature; saved businesses and any profile already written stay
//   paid member     research is included in the plan. While the owner is rolling it out account by account it can be inactive
//                   for a paying customer: that is said as "included, not active on your account yet", never as something to
//                   buy separately, and never as a failure.
//
// Pure: the page decides nothing about money here, it only chooses honest words from facts it already has.

export type ResearchAudience = 'guest' | 'free_member' | 'paid_member'

export type ResearchAvailability = {
  kind: 'on_demand' | 'paid_only' | 'follows_search' | 'included_inactive' | 'active'
  /** The third stage's two lines; null when the real research stage speaks for itself. */
  rail: { value: string; sub: string } | null
  /** One calm sentence for a business that has no profile because of this, or null. */
  note: string | null
}

export function describeResearchAvailability(input: {
  audience: ResearchAudience
  /** The search has finished (so an authorization, if any, has been announced). */
  searchSettled: boolean
  /** Research was authorized for this search. */
  authorized: boolean
}): ResearchAvailability {
  if (input.audience === 'guest') {
    return { kind: 'on_demand', rail: { value: 'Ready to explore', sub: 'Open a business for its profile' }, note: null }
  }
  if (input.audience === 'free_member') {
    return {
      kind: 'paid_only',
      rail: { value: 'Included with paid plans', sub: 'Your businesses are saved' },
      note: 'Automatic business profiles are included with paid plans. Your saved businesses, and any profile already written, stay available.',
    }
  }
  if (input.authorized) return { kind: 'active', rail: null, note: null }
  if (!input.searchSettled) return { kind: 'follows_search', rail: { value: 'Follows your search', sub: 'Included in your plan' }, note: null }
  return {
    kind: 'included_inactive',
    rail: { value: 'Included in your plan', sub: 'Not active on your account yet' },
    note: "Business profiles are included in your plan but aren't active on your account yet. Your saved businesses are unaffected and nothing has been used.",
  }
}

export function audienceFor(input: { isGuest: boolean; paidAccess: boolean }): ResearchAudience {
  return input.isGuest ? 'guest' : input.paidAccess ? 'paid_member' : 'free_member'
}
