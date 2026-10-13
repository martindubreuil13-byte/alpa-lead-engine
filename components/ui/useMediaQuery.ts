'use client'

import { useEffect, useState } from 'react'

/** Whether a CSS media query currently matches. False on the server and until the first check in the browser. */
export default function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const list = window.matchMedia(query)
    const sync = () => setMatches(list.matches)
    sync()
    list.addEventListener('change', sync)
    return () => list.removeEventListener('change', sync)
  }, [query])
  return matches
}
