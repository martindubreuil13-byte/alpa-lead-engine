'use client'

import { useState } from 'react'

import { ProspectingSession } from '@/components/outreach/ProspectingSession'
import { OutreachWorkspace } from '@/components/outreach/OutreachWorkspace'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { supabase } from '@/lib/supabase'

/**
 * Outreach: Commercial workspace for client acquisition.
 *
 * Mental model:
 * - User opens Outreach to acquire clients, not to manage email
 * - Default: Preparation workspace (ProspectingSession)
 * - Queue is the result of preparation, not the entry point
 * - After preparing a campaign → Check for prepared messages → Show execution
 */

type State = 'preparing' | 'executing'

export default function OutreachPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [state, setState] = useState<State>('preparing')

  if (userLoading || !user) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        Loading...
      </div>
    )
  }

  // User is preparing a new campaign
  if (state === 'preparing') {
    return (
      <ProspectingSession
        onComplete={async () => {
          // Campaign prepared. Check if messages exist, then transition.
          try {
            const { count, error } = await supabase
              .from('outreach_queue')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)

            if (!error && count !== null && count > 0) {
              setState('executing')
            } else {
              // No messages yet (Phase 2 will generate them)
              // For now, reset to preparing for next campaign
              setState('preparing')
            }
          } catch (err) {
            console.error('[outreach] Failed to check messages:', err)
            setState('preparing')
          }
        }}
        onCancel={() => {
          // Cancelled mid-preparation, stay in preparation
          setState('preparing')
        }}
      />
    )
  }

  // Campaign prepared, messages ready to review/send
  return (
    <OutreachWorkspace
      onPrepareNew={() => setState('preparing')}
    />
  )
}
