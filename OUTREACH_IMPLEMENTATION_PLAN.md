# Outreach: Implementation Plan (Workspace Separation)

**Status:** READY FOR IMPLEMENTATION  
**Date:** 2026-07-08  
**Objective:** Separate preparation (ProspectingSession) from execution (Outreach Workspace)

---

## First Principles

1. **ProspectingSession** = Preparation workspace (narrow responsibility)
2. **Outreach Workspace** = Execution workspace (review, approve, send)
3. **Clean handoff** = ProspectingSession completes → Outreach Workspace takes over
4. **Single responsibility** = Each workspace has one commercial objective

---

## ProspectingSession: Responsibility & Scope

### What It Does
Prepare today's commercial plan through a guided conversation.

**Steps (Sequential):**
1. Commercial Briefing (What? Who? Goal?)
2. Repository Analysis (Search My Leads)
3. Repository Results (Show matching count)
4. Business Selection (Refine + Capacity)
5. Preparation Mode (Automation level)
6. Campaign Brief (Confirm plan)

**It Ends Here.** After user confirms Campaign Brief, ProspectingSession is complete.

### What It Does NOT Do
- ❌ Generate drafts (Phase 2)
- ❌ Review drafts
- ❌ Manage queues
- ❌ Approve/reject messages
- ❌ Send messages
- ❌ Long-term orchestration

### Responsibility Ends When
User clicks "Start Preparing Outreach" on Campaign Brief.

At this point:
1. ProspectingSession is done
2. Campaign intent is confirmed
3. Control passes to Outreach Workspace

**Just like Discover hands businesses to My Leads.**

---

## Outreach Workspace: Responsibility & Scope

### What It Does
Execute today's outreach: Review, approve, and send prepared messages.

**Operations:**
- Display today's outreach preparation
- Review individual messages
- Approve drafts
- Reject drafts
- Send messages
- Manage bulk operations

### What It Does NOT Do
- ❌ Prepare commercial intent
- ❌ Select businesses
- ❌ Generate new campaigns

### Responsibility Begins When
ProspectingSession calls onComplete() after Campaign Brief confirmation.

---

## Component Map: Where Everything Goes

### ProspectingSession (Remains Unchanged)
```
Location: components/outreach/ProspectingSession.tsx
Responsibility: Prepare campaign intent → Campaign Brief confirmation
Ends: After onComplete() callback
Contains:
  - CommercialBriefing
  - RepositorySearch
  - RepositoryResults
  - RefinementOptions
  - CapacitySelection
  - AutomationLadder
  - CampaignBrief

NEW: After CampaignBrief confirmation, simply call onComplete()
Do NOT add a "review" step.
Do NOT add review queue logic.
Do NOT become responsible for draft execution.
```

### Outreach Workspace (NEW - from existing queue code)
```
Location: components/outreach/OutreachWorkspace.tsx (rename ReviewQueue)
Responsibility: Execute today's outreach
Contains: All current queue functionality, moved as-is
  - fetchQueue() → Fetch today's drafts
  - Stats (Total, Drafts, Approved, Sent, Rejected)
  - Filters (Status, Source, Step, Template, Search)
  - Bulk actions (Approve, Send, Delete)
  - Queue items display (unchanged cards)
  - ReviewPanel (unchanged)
  - Send logic (unchanged)

MOVED FROM: Current /app/dashboard/outreach/page.tsx
SIZE: ~900 lines (preserved, not rewritten)
BEHAVIOR: Unchanged (only responsibility clarity changes)
```

### Outreach Page Orchestrator
```
Location: /app/dashboard/outreach/page.tsx
Responsibility: Route to correct workspace
Logic:
  if (no active campaign)
    → Show ProspectingSession
    
  else if (campaign briefing complete, drafts ready)
    → Show OutreachWorkspace
    
  else if (campaign sent, return to prepare next)
    → Show ProspectingSession (new campaign)
```

---

## Current Components (Unchanged)

```
✓ CommercialBriefing.tsx        - No changes
✓ RepositorySearch.tsx          - No changes
✓ RepositoryResults.tsx         - No changes
✓ RefinementOptions.tsx         - No changes
✓ CapacitySelection.tsx         - No changes
✓ AutomationLadder.tsx          - No changes
✓ CampaignBrief.tsx             - No changes
✓ ReviewPanel.tsx               - No changes
✓ Extracted utilities (badge-utils, FilterSelect, Toast) - No changes
```

---

## Data Flow

### Before Campaign Brief
```
ProspectingSession (preparation)
  ├─ State: Briefing answers, business count, capacity, mode
  ├─ Storage: sessionStorage (ephemeral)
  └─ Ends: Campaign Brief confirmation
```

### After Campaign Brief Confirmation
```
onComplete() callback fires
  ↓
Outreach page receives campaign intent
  ↓
Store intent for persistence (where Phase 2 generates drafts)
  ↓
Trigger draft generation (Phase 2 - implementation later)
  ↓
Show OutreachWorkspace
  ↓
OutreachWorkspace displays drafts
```

### OutreachWorkspace (execution)
```
OutreachWorkspace (execution)
  ├─ State: Queue items, filters, selection
  ├─ Storage: Supabase (persistent)
  ├─ Operations: Review, Approve, Send
  └─ Continues: Until all sent or user exits
```

---

## User-Facing Changes

### Terminology

| Current | New | Reasoning |
|---------|-----|-----------|
| Outreach Queue | (Not exposed) | User is reviewing, not managing queue |
| Commercial Briefing | Prepare Today's Outreach | Natural business language |
| Intent Questions | (Not used) | More natural flow |
| Pipeline Automation | (Not exposed) | Internal implementation detail |
| "Start new campaign" button | (Part of flow) | No separate button, just return to start |

### Page Titles

| Location | Title | Feeling |
|----------|-------|---------|
| ProspectingSession | Prepare Today's Outreach | Conversational, natural |
| OutreachWorkspace | Review Today's Outreach | Calm, focused |
| Campaign Brief | Today's Commercial Plan | Clear, confident |

### Button Language

| Action | New Label | Why |
|--------|-----------|-----|
| Next step | Continue | Natural, conversational |
| Exit flow | Cancel | Simple, clear |
| From review to briefing | Prepare Another Outreach | Business action, not technical |

---

## Implementation Sequence

### 1. Rename ReviewQueue → OutreachWorkspace
- Extract all queue logic from current page.tsx
- Move to new OutreachWorkspace component
- No logic changes, only responsibility clarity

### 2. Update /dashboard/outreach/page.tsx
- Reduce to ~100 lines (orchestrator only)
- Add session/campaign state
- Route between ProspectingSession and OutreachWorkspace

### 3. Update ProspectingSession
- Remove debug logging (clean up)
- Ensure onComplete() callback fires after Campaign Brief
- Do NOT add review step
- Do NOT stay active after campaign confirmation

### 4. Update Page Copy
- "Prepare Today's Outreach" (instead of "Outreach Queue")
- "Review Today's Outreach" (inside OutreachWorkspace)
- "Today's Commercial Plan" (Campaign Brief)
- Remove all technical language (Queue, Pipeline Automation, etc.)

### 5. Simplify Progress Indicators
- Remove wizard-style progress bars
- Use minimal conversational progress
- Example: "Step 1 of 3: Understanding today's outreach"

### 6. Simplify Navigation
- Primary button: Continue
- Secondary button: Cancel
- Avoid unnecessary back buttons
- Return to start only after completion

---

## What Doesn't Change

✓ Database schema  
✓ Discover module  
✓ My Leads module  
✓ Commercial Intelligence  
✓ Admin-only access  
✓ All existing queue functionality  
✓ All existing send/approval logic  
✓ All existing filters and bulk actions  
✓ All existing ReviewPanel functionality  
✓ All ADRs (001-004)

---

## Why This Is Cleaner

### Current Problem
- Outreach page is trying to be both "prepare a campaign" AND "manage queue"
- User lands on a queue, which feels tactical, not strategic
- One page contains two different responsibilities

### Solution: Workspace Separation
- **Preparation** has one job: Prepare today's commercial plan
- **Execution** has one job: Review, approve, and send today's outreach
- **Clean handoff**: Preparation completes → Execution begins
- **Clear flow**: User knows what they're doing at each step

### Benefits
1. **Clearer responsibility** — Each component knows what it owns
2. **Better UX** — User experience matches their commercial objective, not software features
3. **Easier to maintain** — Logic is isolated by responsibility
4. **Easier to extend** — Phase 2 (draft generation) plugs in between Preparation and Execution
5. **Feels like a workflow** — Not a CRM, not an email tool, just today's business activity

---

## Success Criteria

**When implementation is complete:**

- [ ] User lands on "Prepare Today's Outreach"
- [ ] Flow feels like preparing with an advisor, not filling out a form
- [ ] ProspectingSession ends after Campaign Brief
- [ ] OutreachWorkspace takes over for review/send
- [ ] No technical language (queue, pipeline, wizard)
- [ ] Clean separation: Prepare → Execute → Next
- [ ] All existing functionality preserved
- [ ] All existing architecture preserved
- [ ] Zero breaking changes

---

## Ready for Implementation

This plan:
- ✅ Respects all existing ADRs
- ✅ Doesn't redesign database
- ✅ Doesn't change Discover/My Leads/CI
- ✅ Preserves all working functionality
- ✅ Separates responsibilities cleanly
- ✅ Creates better user experience
- ✅ Requires no breaking changes

**Implementation can begin immediately.**
