'use client'

import { useEffect, useRef, type RefObject } from 'react'

import { decideReveal, NAVIGATION_KEYS, revealDelay, shouldMoveFocus } from '@/lib/scraper/results-reveal'

function isEditable(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

/**
 * Moves the customer's attention to the results once, when they become ready.
 *  - `anchorRef`  the settled summary; scrolled to the top of the viewport.
 *  - `headingRef` the results heading; receives focus (without scrolling) if focus would be lost.
 *  - `engineRef`  the engine region, to tell whether focus was inside it.
 * It does nothing while the customer is typing or has been scrolling on their own.
 */
export default function useResultsReveal({
  ready,
  reducedMotion,
  anchorRef,
  headingRef,
  engineRef,
}: {
  ready: boolean
  reducedMotion: boolean
  anchorRef: RefObject<HTMLElement | null>
  headingRef: RefObject<HTMLElement | null>
  engineRef: RefObject<HTMLElement | null>
}) {
  const navigatedRef = useRef(false)

  useEffect(() => {
    const mark = () => {
      navigatedRef.current = true
    }
    const onKey = (event: KeyboardEvent) => {
      if (NAVIGATION_KEYS.includes(event.key) && !isEditable(document.activeElement)) mark()
    }
    window.addEventListener('wheel', mark, { passive: true })
    window.addEventListener('touchmove', mark, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', mark)
      window.removeEventListener('touchmove', mark)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // A new search starts afresh.
  useEffect(() => {
    if (!ready) navigatedRef.current = false
  }, [ready])

  useEffect(() => {
    if (!ready) return

    const timer = window.setTimeout(() => {
      const heading = headingRef.current
      const anchor = anchorRef.current
      if (!heading || !anchor) return

      const active = document.activeElement
      const focusInEditable = isEditable(active)

      const decision = decideReveal({
        reducedMotion,
        userNavigated: navigatedRef.current,
        focusInEditable,
        resultsTop: heading.getBoundingClientRect().top,
        viewportHeight: window.innerHeight,
      })
      if (decision.scroll) anchor.scrollIntoView({ behavior: decision.behavior, block: 'start' })

      if (
        shouldMoveFocus({
          activeInsideEngine: Boolean(active && engineRef.current?.contains(active)),
          activeIsBody: !active || active === document.body,
          focusInEditable,
        })
      ) {
        heading.focus({ preventScroll: true })
      }
    }, revealDelay(reducedMotion))

    return () => window.clearTimeout(timer)
  }, [ready, reducedMotion, anchorRef, headingRef, engineRef])
}
