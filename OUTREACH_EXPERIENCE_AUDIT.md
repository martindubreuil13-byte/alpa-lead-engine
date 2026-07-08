# Outreach Experience Audit & Implementation Plan

**Status:** AUDIT COMPLETE - Ready for approval  
**Date:** 2026-07-08  
**Objective:** Reframe Outreach from Queue-First to Intent-First experience

---

## Executive Summary

Current state: `/dashboard/outreach` opens on legacy Outreach Queue  
Desired state: `/dashboard/outreach` opens on Commercial Briefing, queue becomes "Review Queue" step in the workflow

This plan preserves all existing queue functionality while reordering the experience flow.

---

## Current User Flow (Legacy)

```
/dashboard/outreach
    ↓
[Outreach Queue Page]
    ├─ Header: "Outreach Queue"
    ├─ Stats: Total, Drafts, Approved, Sent, Rejected, Pipeline Automation
    ├─ Filters: Status, Source, Automation Step, Template, Search
    ├─ Bulk Actions: Approve Selected, Send Selected, Delete Selected
    ├─ Queue Items (paginated)
    │   ├─ Checkbox selection
    │   ├─ Company name, email, location
    │   ├─ Badges (status, match, context, source, step, CTA)
    │   ├─ Subject preview
    │   ├─ Email preview
    │   └─ Card actions (Review, Approve, Send, Reject, Send Test, Delete)
    ├─ ReviewPanel (side panel for editing individual drafts)
    └─ Toast notifications
```

---

## Desired User Flow (Intent-First)

```
/dashboard/outreach
    ↓
[Check for active session]
    ├─ If YES → Resume from current step
    └─ If NO → Start new session
    ↓
[Step 1] Commercial Briefing
    ├─ What are you offering today?
    ├─ Who would benefit most from it?
    └─ What would you like them to do?
    ↓
[Step 2] Business Repository Analysis
    ├─ Async search of My Leads
    └─ Show matching count
    ↓
[Step 3] Repository Results
    ├─ "I found X businesses matching your objective"
    ├─ If insufficient (< 5) → Optional "Discover More"
    └─ Ready for next step
    ↓
[Step 4 - Optional] Discover More Businesses
    ├─ Link to Discover module
    └─ Auto-return with new businesses
    ↓
[Step 5] Business Selection
    ├─ RefinementOptions (Industry, Location, Size, CI Signals)
    ├─ CapacitySelection (How many to reach?)
    └─ Filtered count updates in real-time
    ↓
[Step 6] Campaign Brief
    ├─ Offering, Audience, Goal
    ├─ Available count, Selected count
    ├─ Preparation mode
    └─ "Start Preparing Outreach" button
    ↓
[Step 7] Outreach Preparation
    ├─ Draft generation (Phase 2)
    └─ [Placeholder for now]
    ↓
[Step 8] Review Queue
    ├─ Stats: Total, Drafts, Approved, Sent, Rejected
    ├─ Filters: Status, Source, Step, Template, Search
    ├─ Bulk actions: Approve, Send, Delete
    ├─ Queue items with all current functionality
    ├─ ReviewPanel for editing
    └─ Send drafts
    ↓
Done (auto-return to Review Queue for next campaign)
```

---

## Component Audit: Current Outreach Page (1,112 lines)

### State Management
```
CLASSIFICATION: MOVE TO REVIEW QUEUE

Lines: 98-125
showProspecting ← KEEP (new)
items ← MOVE
templates ← MOVE
senderProfile ← MOVE
stats ← MOVE
filteredTotal ← MOVE
loading ← MOVE
activeItem ← MOVE
sourceFilter, stepFilter, templateFilter, statusFilter ← MOVE
searchQuery ← MOVE
page ← MOVE
selectedIds, deleting, approving, sendingIds, testingIds ← MOVE
toast ← MOVE
toastTimer, queueRequestRef ← MOVE
```

### Data Fetching Functions
```
CLASSIFICATION: MOVE TO REVIEW QUEUE

fetchQueue() (lines 149-189)
  - Loads queue items with filters and pagination
  - MOVE: ReviewQueue component needs this

fetchFilterMetadata() (lines 190-232)
  - Loads templates and sender settings
  - MOVE: ReviewQueue needs this

applyQueueFilters() (lines 233-261)
  - Applies filters to Supabase query
  - MOVE: ReviewQueue needs this

fetchQueueStats() (lines 263-315)
  - Counts items by status
  - MOVE: ReviewQueue needs this

showToast() (lines 127-130)
  - Display toast notifications
  - MOVE: ReviewQueue needs this (or use Toast component directly)
```

### Queue Operations Functions
```
CLASSIFICATION: MOVE TO REVIEW QUEUE

callUpdate() (lines 317-345)
  - Approve/reject/save individual item
  - MOVE: ReviewQueue needs this

callDelete() (lines 350-365)
  - Delete queue items
  - MOVE: ReviewQueue needs this

handleDeleteSingle() (lines 367-385)
  - Delete single item with confirmation
  - MOVE: ReviewQueue needs this

handleDeleteSelected() (lines 386-406)
  - Delete multiple selected items
  - MOVE: ReviewQueue needs this

handleClearRejected() (lines 407-428)
  - Clear all rejected items
  - MOVE: ReviewQueue needs this

handleApproveSelected() (lines 429-473)
  - Batch approve drafts
  - MOVE: ReviewQueue needs this

callSend() (lines 474-507)
  - Send queue items
  - MOVE: ReviewQueue needs this

handleSendSingle() (lines 508-530)
  - Send single item with confirmation
  - MOVE: ReviewQueue needs this

handleSendSelected() (lines 531-570)
  - Send multiple selected items
  - MOVE: ReviewQueue needs this

handleSendTest() (lines 574-595)
  - Send test email to user
  - MOVE: ReviewQueue needs this

toggleSelect() (lines 596-604)
  - Toggle item selection
  - MOVE: ReviewQueue needs this

toggleSelectAll() (lines 613-648)
  - Select all/none on page
  - MOVE: ReviewQueue needs this

handleSave/handleApprove/handleReject (lines 633-652)
  - Callbacks for ReviewPanel
  - MOVE: ReviewQueue needs these

useEffect hooks (lines 132-145)
  - Data loading logic
  - MOVE: ReviewQueue needs this
```

### Render Section Components

#### New - Intent Experience (KEEP)
```
Lines 664-680: ProspectingSession conditional
  - KEEP: This is the new landing experience
  - Show if showProspecting === true
```

#### Legacy - Queue Experience (MOVE to ReviewQueue)

**Header Section** (lines 685-706)
```
CLASSIFICATION: REMOVE

"Outreach Queue" title
"Start new campaign" button ← REMOVE (not needed, landing IS new campaign)

These should be removed from intent experience.
In ReviewQueue context, header becomes "Review Queue" (simplified).
```

**Rejected Count Button** (lines 708-721)
```
CLASSIFICATION: MOVE
Lines: 708-721
Move to ReviewQueue. In intent flow, there are no rejected items to clear.
```

**Stats Row** (lines 723-743)
```
CLASSIFICATION: MOVE
Lines: 723-743
Display: Total, Drafts, Approved, Sent, Rejected, Pipeline Automation
Move to ReviewQueue component.
In intent flow: No stats needed (no drafts exist yet).
```

**Filters Section** (lines 745-831)
```
CLASSIFICATION: MOVE
Lines: 745-831
Contains:
  - Search input
  - FilterSelect (Status, Source, Step, Template)
  - Pagination info
  - Reset filters button

Move entire section to ReviewQueue.
In intent flow: Different filtering (RefinementOptions) for business selection.
```

**Bulk Action Bar** (lines 833-876)
```
CLASSIFICATION: MOVE
Lines: 833-876
Contains:
  - Approve Selected
  - Send selected
  - Delete selected
  - Clear selection

Move to ReviewQueue.
In intent flow: No bulk actions needed.
```

**Empty State** (lines 878-892)
```
CLASSIFICATION: MOVE
Lines: 878-892
"No emails in queue" message

Move to ReviewQueue.
In intent flow: Different empty state (start briefing).
```

**Queue Items List** (lines 894-1068)
```
CLASSIFICATION: MOVE
Lines: 894-1068
Contains:
  - Select all checkbox
  - Item cards with:
    - Checkbox
    - Company name, email, location
    - Badges (status, match, context, source, step, CTA, template)
    - Subject preview
    - Email preview
    - Card actions (Review, Approve, Send, Reject, Send Test, Delete)

Move entire section to ReviewQueue.
In intent flow: No queue items to display.
```

**Pagination** (lines 1070-1094)
```
CLASSIFICATION: MOVE
Lines: 1070-1094
Page navigation

Move to ReviewQueue.
In intent flow: No pagination needed.
```

**ReviewPanel** (lines 1098-1106)
```
CLASSIFICATION: REUSE
Lines: 1098-1106
Side panel for editing individual drafts

REUSE in ReviewQueue.
Already built, no changes needed.
In intent flow: No review needed yet.
```

**Toast** (lines 1108-1109)
```
CLASSIFICATION: REUSE
Lines: 1108-1109
Toast notifications

REUSE throughout the app (already extracted).
Both intent flow and review queue can use Toast.
```

---

## Component Summary

### KEEP (In Intent Flow)
- ProspectingSession conditional (already implemented)
- CommercialBriefing (already built)
- RepositorySearch (already built)
- RepositoryResults (already built)
- RefinementOptions (already built)
- CapacitySelection (already built)
- CampaignBrief (already built)
- AutomationLadder (already built)

### MOVE (To New ReviewQueue Component)
- All state related to queue
- All data fetching functions (fetchQueue, fetchFilterMetadata, applyQueueFilters, fetchQueueStats)
- All queue operations (approve, reject, delete, send)
- All selection/bulk action handlers
- Queue items render section (cards, filters, pagination)
- Stats display
- Filters section
- Bulk action bar
- ReviewPanel usage
- Toast usage

### REMOVE (From Intent Flow)
- "Outreach Queue" title
- "Start new campaign" button
- All legacy queue UI

### REUSE
- Badge utilities (statusBadge, matchBadge, etc.)
- FilterSelect component
- Toast component
- ReviewPanel component

---

## Implementation Plan

### Phase 1: Create ReviewQueue Component
```typescript
// New file: components/outreach/ReviewQueue.tsx
// Size: ~900 lines (mostly moved from current page)
// Contains: All queue functionality, unchanged behavior
// Used by: ProspectingSession as final step
```

### Phase 2: Refactor /dashboard/outreach/page.tsx
```typescript
// Current: ~1,112 lines (queue-first)
// New: ~50 lines (intent-first orchestrator)

export default function OutreachPage() {
  const { user, loading } = useCurrentUser()
  const [activeSession, setActiveSession] = useState(null)

  useEffect(() => {
    // Load active session from sessionStorage
    // If exists AND not at review step → resume
    // If not exists → start new
  }, [])

  // Only conditional: show ProspectingSession (with extended steps)
  // ProspectingSession handles: Briefing → Analysis → Selection → Brief → [Prep] → Review
}
```

### Phase 3: Extend ProspectingSession
```typescript
// Add new steps:
// - preparation (Phase 2 placeholder)
// - review (new ReviewQueue step)
// - done

// At "review" step: Render ReviewQueue component
// At "done" step: Clear session, return to intent
```

### Phase 4: Update Navigation
```typescript
// From My Leads "Start outreach" button
// Navigate to /dashboard/outreach (unchanged)
// But now lands on Commercial Briefing (changed UX)
// Can pass business_id as query param to pre-fill selection
```

---

## New Page Structure

```
/app/dashboard/outreach/page.tsx (50 lines)
  └─ Load active session
  └─ Show ProspectingSession

components/outreach/ProspectingSession.tsx (300+ lines)
  └─ Orchestrate full workflow including new "review" step
  └─ At review step: render ReviewQueue

components/outreach/ReviewQueue.tsx (900+ lines) ← NEW
  └─ Contains all current queue functionality
  └─ No changes to queue behavior
  └─ Used only as final step in workflow

[Existing workflow components - unchanged]
  ├─ CommercialBriefing.tsx
  ├─ RepositorySearch.tsx
  ├─ RepositoryResults.tsx
  ├─ RefinementOptions.tsx
  ├─ CapacitySelection.tsx
  ├─ CampaignBrief.tsx
  └─ AutomationLadder.tsx
```

---

## User Experience Changes

### Before
- Land on queue
- See 10-50 existing queue items
- Click "Start new campaign"
- Enter briefing flow
- Return to queue to see drafts

### After
- Land on Commercial Briefing
- Answer 3 questions
- See matching businesses
- Refine selection
- Set capacity
- Confirm campaign
- See draft preparation
- Enter Review Queue
- Send from queue

### Key Improvements
1. **Intent-first** — User starts by saying what they want to do
2. **Guided** — Step-by-step flow from decision to execution
3. **Conversational** — Feels like working with an advisor, not software
4. **Clear progression** — User always knows where they are
5. **Queue deprioritized** — Queue becomes tactical, not strategic

---

## Blocked Decisions

**None** — All decisions are clear and approved.

---

## Ready for Approval

**Components Audit**: ✓ Complete  
**Flow Mapping**: ✓ Complete  
**Component Classification**: ✓ Complete  
**Implementation Strategy**: ✓ Complete  

**Next Step**: Approval to proceed with implementation.

---

**Implementation will:**
1. Create ReviewQueue component (move existing code)
2. Simplify Outreach page (new orchestrator)
3. Extend ProspectingSession (add review step)
4. No architecture changes
5. No database changes
6. No breaking changes

**All existing queue functionality is preserved.**
**Only the entry point and flow order change.**
