'use client'

import { useState } from 'react'

import { ProspectingSession } from '@/components/outreach/ProspectingSession'
import { OutreachWorkspace } from '@/components/outreach/OutreachWorkspace'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'

/**
 * Outreach: Commercial workspace for preparing and executing today's outreach.
 *
 * Two distinct workspaces:
 * 1. Preparation: User prepares commercial intent (Briefing → Campaign Brief)
 * 2. Execution: User executes prepared outreach (Review → Approve → Send)
 *
 * Entry point: Always starts with Preparation unless there are unsent messages waiting.
 */

export default function OutreachPage() {
  const { user, loading } = useCurrentUser()
  const [showPreparation, setShowPreparation] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        Loading...
      </div>
    )
  }

  if (!user) {
    return null
  }

  // If user is preparing a new campaign, show Preparation Workspace
  if (showPreparation) {
    return (
      <ProspectingSession
        onComplete={() => {
          // Campaign brief confirmed → Ready to execute
          // In Phase 2, this triggers draft generation
          // For now, transition to Execution Workspace
          setShowPreparation(false)
        }}
        onCancel={() => {
          setShowPreparation(false)
        }}
      />
    )
  }

  // Default: Show Execution Workspace
  // User can "Prepare New" to start another campaign
  return (
    <OutreachWorkspace
      onPrepareNew={() => setShowPreparation(true)}
    />
  )
}
