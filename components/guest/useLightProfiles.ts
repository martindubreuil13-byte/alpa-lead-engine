'use client'

import { useCallback, useRef, useState } from 'react'

import { hasEnoughEvidence, readStoredLightProfile } from '@/lib/guest/light-profile'
import { trackEvent } from '@/lib/track'
import type { TrialLead } from '@/lib/trial'

export type ProfileState = 'loading' | 'failed'

const BUSY_RETRY_MS = 2500
const BUSY_RETRIES = 3

/**
 * Asks the server for a short profile when the visitor opens a business, and merges the answer into the list. Nothing runs for a
 * business that already has one, that the website gave too little text for, or that is already being written; a failure is shown
 * quietly and retried only the next time the business is opened. It never throws into the page.
 */
export function useLightProfiles(setLeads: (update: (current: TrialLead[]) => TrialLead[]) => void) {
  const [states, setStates] = useState<Record<string, ProfileState>>({})
  const inFlight = useRef(new Set<string>())

  const setState = useCallback((id: string, state: ProfileState | null) => {
    setStates((current) => {
      const next = { ...current }
      if (state) next[id] = state
      else delete next[id]
      return next
    })
  }, [])

  const request = useCallback(
    async (lead: TrialLead) => {
      if (!lead.id || lead.light_profile || inFlight.current.has(lead.id) || !hasEnoughEvidence(lead.website_intelligence)) return
      inFlight.current.add(lead.id)
      setState(lead.id, 'loading')
      try {
        for (let attempt = 0; attempt <= BUSY_RETRIES; attempt += 1) {
          const response = await fetch('/api/guest/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId: lead.id }),
          })
          const data = await response.json().catch(() => null)
          const profile = response.ok ? readStoredLightProfile(data?.profile) : null
          if (profile) {
            setLeads((current) => current.map((entry) => (entry.id === lead.id ? { ...entry, light_profile: profile } : entry)))
            setState(lead.id, null)
            void trackEvent('trial_profile_shown', { metadata: { cached: data?.cached === true } })
            return
          }
          // Another request is already writing this business's profile: wait a moment and ask again for the saved result.
          if (response.status === 409 && attempt < BUSY_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS))
            continue
          }
          // Too little website text is not a failure and is not announced: the website's own words are already shown.
          setState(lead.id, response.status === 422 ? null : 'failed')
          void trackEvent('trial_profile_unavailable', { metadata: { code: typeof data?.code === 'string' ? data.code : 'unknown' } })
          return
        }
        setState(lead.id, 'failed')
      } catch {
        setState(lead.id, 'failed')
      } finally {
        inFlight.current.delete(lead.id)
      }
    },
    [setLeads, setState]
  )

  return { states, request }
}
