// Opening the trial must never be lost. The landing button can be activated before the search component has mounted (React
// hydrates the clicked component first), and a browser event with no listener vanishes silently. So the request is also kept
// as a flag the search component reads when it mounts, and as a ?trial=1 address a no-JavaScript or pre-hydration tap follows.

export const OPEN_TRIAL_EVENT = 'alpa:open-trial-flow'
export const OPEN_TRIAL_HREF = '/?trial=1'
const FLAG = '__alpaTrialOpenRequested'

type FlagWindow = Window & { [FLAG]?: boolean }

export function requestTrialOpen(win: Window = window): void {
  ;(win as FlagWindow)[FLAG] = true
  try {
    win.dispatchEvent(new CustomEvent(OPEN_TRIAL_EVENT))
  } catch {
    // the flag still lets the component open when it mounts
  }
}

/** True once per request: a pending flag from the button, or ?trial=1 in the address. Clears the flag. */
export function consumeTrialOpenRequest(win: Window = window): boolean {
  const flagged = Boolean((win as FlagWindow)[FLAG])
  ;(win as FlagWindow)[FLAG] = false
  let param = false
  try {
    param = new URLSearchParams(win.location.search).get('trial') === '1'
  } catch {
    // no readable address
  }
  return flagged || param
}

/** Removes ?trial=1 from the address bar so a reload does not reopen the dialog. */
export function clearTrialParam(win: Window = window): void {
  try {
    const url = new URL(win.location.href)
    if (url.searchParams.get('trial') !== '1') return
    url.searchParams.delete('trial')
    win.history.replaceState(win.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // leaving the parameter in place is harmless
  }
}
