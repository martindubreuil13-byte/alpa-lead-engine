'use client'

import { ProspectingSession } from '@/components/outreach/ProspectingSession'

/**
 * Outreach: The Daily Commercial Strategy Session
 *
 * PRINCIPLE: Every morning, the user begins a fresh preparation session.
 * This page has ONE job: facilitate today's commercial strategy conversation.
 *
 * The user opens Outreach to:
 * 1. Define today's commercial objective
 * 2. Let ALPA find the right businesses
 * 3. Review ALPA's reasoning
 * 4. Prepare personalized outreach
 * 5. Review and send messages
 *
 * Outreach History (previous sessions, prepared messages from yesterday):
 * - These belong in a separate context/route
 * - Never the default landing page
 * - Never interrupt today's preparation
 *
 * Hydration:
 * - Server renders ProspectingSession
 * - Client hydrates ProspectingSession
 * - No state transitions during hydration
 * - No checking database before first render
 * - Deterministic and stable
 */

export default function OutreachPage() {
  // Auth is guaranteed by layout/middleware
  // No need to check user status here

  // The entire Outreach experience is the ProspectingSession
  // No routing based on database state
  // No checking for prepared messages
  // No showing the queue as the default landing
  //
  // When preparation completes, the messages will be stored
  // and can be accessed through the execution flow
  // but they don't determine what the user sees first
  return (
    <ProspectingSession
      onComplete={() => {
        // Preparation complete
        // In Phase 2, this will show the prepared messages
        // For now, the session is complete
      }}
      onCancel={() => {
        // User cancelled - they stay in preparation
        // ready to start a new session
      }}
    />
  )
}
