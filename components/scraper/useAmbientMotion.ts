'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Whether decorative motion may run right now. It is true only while all of these hold:
 *  - the caller wants it (`enabled`: a search is genuinely in progress)
 *  - the customer allows motion (`reducedMotion` is false)
 *  - the tab is visible
 *  - the element is on screen
 * Decorative loops are not rendered at all when this is false, so a hidden tab, a scrolled-away
 * engine and a finished search cost nothing.
 */
export default function useAmbientMotion(
  ref: RefObject<Element | null>,
  { enabled, reducedMotion }: { enabled: boolean; reducedMotion: boolean }
) {
  const [visible, setVisible] = useState(true)
  const [onScreen, setOnScreen] = useState(true)

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.05 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return enabled && !reducedMotion && visible && onScreen
}
