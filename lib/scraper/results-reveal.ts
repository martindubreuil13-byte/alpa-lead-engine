// When, and whether, the page moves the customer's attention to the results.
//
// The reveal is a courtesy, never a takeover. It is skipped whenever the customer is doing something
// else (typing, scrolling on their own) or when the results are already comfortably in view. These
// rules are pure so they can be tested without a browser.

/** After the engine begins to settle, wait this long before moving. Zero for reduced motion. */
export const REVEAL_DELAY_MS = 900

/** Keys that mean "I am navigating this page myself". */
export const NAVIGATION_KEYS = ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar']

export type RevealContext = {
  reducedMotion: boolean
  /** The customer scrolled, or used a navigation key, since this search began. */
  userNavigated: boolean
  /** A text field, select or editable region currently has focus. */
  focusInEditable: boolean
  /** Top of the results heading relative to the viewport, in px (negative = above). */
  resultsTop: number
  viewportHeight: number
}

export type RevealDecision =
  | { scroll: false; reason: 'editing' | 'navigated' | 'in-view' }
  | { scroll: true; behavior: 'smooth' | 'auto' }

export function revealDelay(reducedMotion: boolean) {
  return reducedMotion ? 0 : REVEAL_DELAY_MS
}

export function decideReveal(context: RevealContext): RevealDecision {
  if (context.focusInEditable) return { scroll: false, reason: 'editing' }
  if (context.userNavigated) return { scroll: false, reason: 'navigated' }
  // Heading already in the upper two thirds of the screen: nothing to do.
  if (context.resultsTop >= 0 && context.resultsTop <= context.viewportHeight * 0.66) {
    return { scroll: false, reason: 'in-view' }
  }
  return { scroll: true, behavior: context.reducedMotion ? 'auto' : 'smooth' }
}

/**
 * When the results appear, the Stop button the customer may have been focused on disappears.
 * Focus is moved to the results heading only if it would otherwise be lost: it was on that
 * button (inside the engine) or nowhere in particular. It never takes focus from a field.
 */
export function shouldMoveFocus(input: { activeInsideEngine: boolean; activeIsBody: boolean; focusInEditable: boolean }) {
  if (input.focusInEditable) return false
  return input.activeInsideEngine || input.activeIsBody
}
