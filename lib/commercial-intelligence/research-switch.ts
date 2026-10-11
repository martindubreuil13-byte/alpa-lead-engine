// The emergency stop for Business Intelligence research.
//
// One server-side environment variable decides whether ANY research may start:
//
//   CI_RESEARCH_ENABLED=true   research may start
//   anything else / unset      research is OFF (the default)
//
// Only the exact value "true" turns it on: "1", "yes", "TRUE " with a typo or an empty value do not.
// It is read from the server's environment at the moment of each check, never from a request, a cookie,
// a header, the database or the browser, so a customer has no way to switch it on. Turning it OFF stops
// new claims immediately (the next tick or request) and changes nothing else: queued jobs, running jobs
// and stored profiles are left exactly as they are.
//
// Checking the switch never starts research and never touches the database.

export const RESEARCH_SWITCH_ENV = 'CI_RESEARCH_ENABLED'

type Env = Record<string, string | undefined>

export function isResearchEnabled(env: Env = process.env): boolean {
  return env[RESEARCH_SWITCH_ENV]?.trim() === 'true'
}

export class ResearchDisabledError extends Error {
  readonly code = 'RESEARCH_DISABLED'
  constructor() {
    super('Business Intelligence research is switched off')
    this.name = 'ResearchDisabledError'
  }
}

export function assertResearchEnabled(env: Env = process.env): void {
  if (!isResearchEnabled(env)) throw new ResearchDisabledError()
}

export function getResearchSwitchStatus(env: Env = process.env) {
  const enabled = isResearchEnabled(env)
  return {
    enabled,
    state: enabled ? ('on' as const) : ('off' as const),
    variable: RESEARCH_SWITCH_ENV,
    configured: env[RESEARCH_SWITCH_ENV] !== undefined,
  }
}
