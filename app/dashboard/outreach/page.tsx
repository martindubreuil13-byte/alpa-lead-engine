'use client'

import { useEffect, useState } from 'react'

import { ProspectingSession } from '@/components/outreach/ProspectingSession'
import { OutreachWorkspace } from '@/components/outreach/OutreachWorkspace'
import { EmptyStateOutreach } from '@/components/outreach/EmptyStateOutreach'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { supabase } from '@/lib/supabase'

/**
 * Outreach: Commercial workspace for client acquisition.
 *
 * Three distinct experiences:
 * 1. Empty State: No campaigns prepared. Invite to prepare.
 * 2. Preparation: User preparing today's campaign (Briefing → Brief)
 * 3. Execution: Campaign prepared, ready to review/send
 *
 * Mental model:
 * - User opens to acquire clients, not to manage email
 * - Preparation creates work, Execution processes work
 * - Never show queue until campaign is prepared
 */

type State = 'loading' | 'empty' | 'preparing' | 'executing'

export default function OutreachPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [state, setState] = useState<State>('loading')
  const [messageCount, setMessageCount] = useState(0)

  // Check if there are any prepared messages waiting
  useEffect(() => {
    if (userLoading || !user) return

    const checkMessages = async () => {
      try {
        const { count, error } = await supabase
          .from('outreach_queue')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)

        if (!error && count !== null && count > 0) {
          setMessageCount(count)
          setState('executing')
        } else {
          setState('empty')
        }
      } catch (err) {
        console.error('[outreach] Failed to check messages:', err)
        setState('empty')
      }
    }

    checkMessages()
  }, [user, userLoading])

  if (userLoading || state === 'loading') {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        Loading...
      </div>
    )
  }

  if (!user) {
    return null
  }

  // User is preparing a new campaign
  if (state === 'preparing') {
    return (
      <ProspectingSession
        onComplete={() => {
          // Campaign prepared → Check for messages and transition to executing
          setState('executing')
        }}
        onCancel={() => {
          // User cancelled preparation
          setState(messageCount > 0 ? 'executing' : 'empty')
        }}
      />
    )
  }

  // Campaign prepared, ready to review/send
  if (state === 'executing') {
    return (
      <OutreachWorkspace
        onPrepareNew={() => setState('preparing')}
      />
    )
  }

  // No campaigns prepared → Show invitation
  return (
    <EmptyStateOutreach
      onPrepareOutreach={() => setState('preparing')}
    />
  )
}
