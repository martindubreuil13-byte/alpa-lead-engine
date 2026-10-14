// Who may have AUTOMATIC Business Intelligence after a Discover run: paying members (and the operator's own admin plan), decided from
// the plan the live subscription resolves to. A free member, and a member whose subscription has lapsed (which resolves to 'free'),
// keep every saved business and profile but are not authorized for new automatic research. This is the plan rule only; whether
// research is switched on, allow-listed and within budget is still decided by the database.
export function isEntitledToAutomaticResearch(plan: string | null | undefined): boolean {
  return plan === 'admin' || plan === 'prospector' || plan === 'starter' || plan === 'pro'
}
