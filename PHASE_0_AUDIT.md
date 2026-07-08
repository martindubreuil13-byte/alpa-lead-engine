# Phase 0 Audit: My Leads as Permanent Repository

**Date:** 2026-07-07  
**Principle Under Review:** My Leads is the permanent, immutable repository of all discovered businesses. All other modules reference businesses in My Leads; no module owns, duplicates, or moves businesses.

---

## Executive Summary

The current ALPA architecture **violates the repository principle in 5 critical ways:**

1. **Duplicate lead views** — Multiple pages show the same lead data (My Leads, Leads Inbox, Lead Library)
2. **Terminal states suggesting deletion** — Users archive/delete leads; architecture implies finality rather than status
3. **Scattered module responsibilities** — Leads can be in "pipeline", "outreach queue", or "inbox" as if they move between modules
4. **No clear single entry point** — Navigation doesn't guide users to My Leads as the authoritative source
5. **Terminology inconsistency** — Leads are called different things in different modules, leading to conceptual confusion

---

## Current Module Structure

### Navigation (DashboardShell.tsx)

```
Dashboard (home)
├─ My Leads ⭐ [admin-only, accent highlight]
├─ Leads Inbox [legacy]
├─ Discover (Scraper)
├─ Lead Library [paid-only]
├─ Pipeline (Kanban)
├─ Outreach Queue [admin-only]
├─ Templates
├─ Settings
└─ Agent (Beta)
```

**Problem:** Navigation doesn't reflect user journey. "My Leads" and "Leads Inbox" both appear, creating confusion about where leads actually live. Discover comes *after* My Leads instead of being the acquisition path.

---

## Detailed Audit Findings

### 1. Duplicate Lead Storage & Retrieval

#### Issue: Three different views of the same lead

**My Leads Page** (`app/dashboard/my-leads/page.tsx`)
- Fetches ALL leads for user
- Shows: company_name, CI status, contact info, relationship memory, next actions
- Role: "Workspace for reviewing, filtering, and managing"
- Status: Admin-only, accent-highlighted
- UI paradigm: Expansible cards with relationship progression

**Leads Inbox** (`app/dashboard/leads/page.tsx`)
- Also fetches leads for user
- Shows: status, activity, contact info
- Role: Legacy "inbox" pattern
- Status: Accessible to all users
- UI paradigm: Table/list view

**Lead Library** (`app/dashboard/library/page.tsx`)
- Searchable historical view of leads
- Role: "Search and revisit full lead history"
- Status: Paid-only feature
- UI paradigm: Search + history view

**Audit Finding:**
- Three separate queries of the same `leads` table
- Three different UI paradigms for the same entity
- Users don't know which to use
- Dashboard hints to "My Leads" but still shows "Leads Inbox" in nav
- **Violation:** My Leads should be THE view; Leads Inbox and Library should be historical/search refinements of the same repository, not separate modules

---

### 2. Terminal States: Archive vs. Delete

#### Issue: Architecture suggests leads "leave" My Leads

**Current Behavior:**
```typescript
// From MyLeadsWorkspaceClient.tsx
async function handleArchive(leadId: string) {
  setArchivedLeadIds((prev) => new Set([...prev, leadId]))
  const result = await archiveLeads([leadId])
}

async function handleDeletePermanently(leadId: string) {
  setDeletedLeadIds((prev) => new Set([...prev, leadId]))
  const result = await deleteLead(leadId)
}
```

- "Archived" leads move to a separate view
- "Deleted" leads are permanently removed
- UI language: "Archive", "Restore", "Delete permanently"
- Pattern: leads are "moved" or "removed"

**Archive UI Copy:**
```typescript
// From getLeadMetadata()
if (isArchived) {
  return {
    priority: 'archived',
    priorityLabel: 'Archived',
    activitySummary: 'No further action',
  }
}
```

**Audit Finding:**
- Language of "moving" leads contradicts repository principle
- Archive/Delete suggest leads leave My Leads
- Better framing: All leads remain in repository; status changes from `active` → `archived` → `inactive`
- **Violation:** UI/UX treats archive as "moving" not "status change"

---

### 3. Module Responsibility Bleed

#### Issue: Unclear ownership of lead state

**Discover Module (Scraper)**
- Creates leads in the `leads` table
- Leads → Commercial Intelligence queue (auto-enqueued)
- Responsibility: Acquisition only
- **Problem:** Creates leads but doesn't manage them after creation

**Outreach Queue Module**
- Reads leads via `outreach_queue` join table
- Creates draft emails for leads
- Marks leads as "in outreach" conceptually
- **Problem:** Suggests leads "belong to" outreach queue while drafts exist

**Pipeline (Kanban)**
- Shows leads by pipeline stage
- Allows drag-drop to change stage
- **Problem:** Pipeline stage is a *transient attribute*, not lead ownership

**My Leads**
- Shows ALL leads regardless of outreach/pipeline state
- Also shows pipeline_stage and outreach_attempts
- **Problem:** Duplicates pipeline information; no single place to change lead status

**Audit Finding:**
```
Conceptual confusion in current design:
├─ Discover "owns" leads while importing? (No, it only creates)
├─ Outreach Queue "owns" leads while in draft? (No, it only references)
├─ Pipeline "owns" leads while moving through stages? (No, it only tracks status)
└─ My Leads owns all? (Yes, but UI doesn't make this clear)
```
- **Violation:** Multiple modules appear to have simultaneous "ownership" of leads

---

### 4. Navigation Flow Doesn't Match User Journey

#### Issue: Navigation order doesn't guide user actions

**Current Navigation:**
1. Dashboard (command center)
2. **My Leads** ← accent highlighted, admin-only
3. Leads Inbox ← suggests secondary view
4. Discover ← comes after leads views
5. Lead Library
6. Pipeline
7. Outreach Queue

**User's Actual Journey:**
1. **Discover** → Find businesses (acquisition)
2. **My Leads** → Review, qualify, organize (repository)
3. **Outreach Queue** → Prepare outreach (execution)
4. **Pipeline** → Track outcomes (lifecycle)

**Audit Finding:**
- Navigation order suggests: Dashboard → view leads → search → discover
- Should suggest: Dashboard → discover → organize (My Leads) → outreach → pipeline
- Discover should appear higher in nav
- Outreach should clearly follow My Leads selection
- **Violation:** Navigation doesn't reflect the 80/15/5 philosophy (80% discovery/qualification, 15% execution, 5% pipeline)

---

### 5. Terminology Inconsistency

#### Issue: "Leads" vs. "Businesses" vs. "Prospects" across UI

**Discover (Scraper)**
- Uses: "businesses", "leads", "prospects"
- Example: "Start by discovering your first prospects. Run a focused search..."
- Column: `company_name` (singular entity)

**My Leads**
- Uses: "leads", "businesses" (in internal code)
- Concept in UI: Individual business records
- Status values: inbox, contacted, followup_due, closed_no_response, etc.

**Outreach Queue**
- Uses: "leads", "drafts", "campaigns"
- Concept: Lead + email template = outreach item

**Pipeline**
- Uses: "leads", "pipeline stages"
- Concept: Lead progression through funnel

**Audit Finding:**
```
Terminology mapping inconsistency:
├─ Discover: "prospect" (acquisition language)
├─ My Leads: "lead" (status tracking language)
├─ Outreach: "lead" (execution language)
└─ Pipeline: "lead" (outcome language)

No unified language. Should be:
├─ Discover: "business" (discovery language)
├─ My Leads: "business" (repository language)
├─ Outreach: "business" (execution references the business)
└─ Pipeline: "opportunity" (outcome is tied to opportunity, not business)
```
- **Violation:** Inconsistent terminology obscures the "business as permanent center" principle

---

## Module Responsibility Assessment

### ✅ Correct Pattern (Reference Only)

**Outreach Queue** — References businesses without owning them
```typescript
SELECT lead_id, review_status, status
FROM outreach_queue
WHERE user_id = $1
```
- Creates drafts for a business
- Does not modify the business record
- Clean separation

**Pipeline** — Status attribute only
```typescript
// In leads table: pipeline_stage, close_reason
// Pipeline module just views/updates this field
```
- Shows business by stage
- Updates stage attribute on business
- Does not create/delete business

### ⚠️ Incorrect Pattern (Ownership Confusion)

**Archive/Delete in My Leads** — Deletes vs. status-change
```typescript
async function handleArchive(leadId: string) {
  // Sets status or deletes? Architecture unclear
  await archiveLeads([leadId])
}
```
- Mixed signal: is archive a deletion or status change?
- Code shows it's archive-in-place but UI suggests terminal state
- Different mental model than "update status"

**Discover auto-enqueue (now fixed)** — Was ownership violation
- ~Previous behavior~: Worker created queue entries
- **Current behavior**: Enqueue happens at lead creation
- **Better than before**, but still worth auditing: is lead creation synchronously enqueuing now?

---

## Navigation & UX Consistency Issues

### My Leads Page Analysis

**Strengths:**
- ✅ Comprehensive view of every business
- ✅ Shows relationship progression (Discovered → Validated → Ready → First Contact → etc.)
- ✅ Integrated CI results viewing
- ✅ Priority-based organization (ready, overdue, reply, review, archived)
- ✅ Bulk actions preserved (archive, delete, export)
- ✅ Search + filtering works well

**Weaknesses:**
- ❌ Only for admin users (why?)
- ❌ Admin-only restriction creates "secondary" path for regular users → Leads Inbox
- ❌ "Archived" view separates active from archived (should be filter, not mode)
- ❌ Doesn't show "next step" to move to outreach
- ❌ No clear way to start outreach from My Leads (button says "Start outreach" but routes nowhere)

---

## Critical Observations

### Observation 1: My Leads is "Premium" but Leads Inbox is "Default"

Current navigation:
- My Leads: Admin-only, accent-highlighted ("future-ready workspace")
- Leads Inbox: Default for all users

**Problem:** This inverts the hierarchy. If My Leads is the permanent repository, it should be *required* for all users, not optional/admin-only.

**Architectural Implication:** The system treats My Leads as "new and shiny" rather than "foundational".

---

### Observation 2: Archive UI Contradicts Repository Principle

Current UX:
```
Active leads view [primary]
  └─ Archived leads view [secondary]

Button: "Archive" → moves to secondary view
Button: "Delete permanently" → removes from repository
```

Better UX under repository principle:
```
All leads view [single source]
  ├─ Status: active [filter active only]
  ├─ Status: archived [filter archived only]
  └─ Status: deleted [soft-delete, only visible to owner for 30 days]

All filtered by single status attribute, not separate views
```

---

### Observation 3: Outreach Queue Position Suggests "After My Leads"

Current nav positions Outreach Queue *after* all lead management modules. But conceptually:
- Discover → finds businesses
- My Leads → qualifies businesses
- Outreach Queue → *references* specific businesses for outreach

**Problem:** Navigation doesn't clarify that Outreach Queue is an action taken *from* My Leads, not a separate destination.

---

### Observation 4: Lead Library is Redundant

"Lead Library: Search and revisit your full lead history from one organized workspace."

But My Leads already:
- Has search
- Shows all leads
- Is organized
- Shows created_at timestamp

**Problem:** Lead Library seems like duplicate functionality. If it's meant to be "historical search", it should be a search mode within My Leads, not a separate module.

---

## Violations Summary

| Violation | Location | Severity | Impact |
|-----------|----------|----------|--------|
| Duplicate lead views (3 modules) | My Leads, Leads Inbox, Lead Library | HIGH | User confusion about authoritative source |
| Archive/delete as "moving" not "status" | My Leads UI/copy | MEDIUM | Contradicts repository principle |
| Module responsibility unclear | Outreach, Pipeline, Discover | MEDIUM | Suggests leads "belong to" multiple places |
| Navigation doesn't reflect journey | DashboardShell.tsx | MEDIUM | Users can't intuitively find next action |
| Terminology inconsistency | All modules | LOW | Conceptual confusion; no semantic clarity |
| My Leads is admin-only | DashboardShell.tsx | HIGH | Repository principle only applies to some users |
| Outreach button goes nowhere | MyLeadsWorkspaceClient.tsx | HIGH | "Start outreach" button is dead-end |
| Lead Library duplicates My Leads | app/dashboard/library | MEDIUM | Redundant module consuming maintenance |

---

## Recommendations for Phase 0

### Clarification Goal
**Make My Leads the obvious, universal, permanent repository of every discovered business.**

### Four Changes (Minimal, Maximum Clarity)

#### 1. Navigation Restructuring
```
Current:
├─ Dashboard
├─ My Leads [admin-only]
├─ Leads Inbox
├─ Discover
├─ Lead Library
├─ Pipeline
└─ Outreach Queue

Proposed:
├─ Dashboard
├─ Discover [find businesses]
├─ My Leads [manage businesses] ← primary, all users
├─ Pipeline [outcomes]
├─ Outreach Queue [execution]
├─ Templates
└─ Settings

Removed:
├─ Leads Inbox [consolidate into My Leads]
├─ Lead Library [consolidate into My Leads search]
```

#### 2. My Leads Accessibility
```
Current: Admin-only restriction on My Leads
Proposed: All users can access My Leads

Reasoning:
- If My Leads is the repository, all users need it
- Leads Inbox can be deleted (its role absorbed by My Leads)
- Free users see same structure, just with monthly/daily limits
```

#### 3. Archive as Status, Not Movement
```
Current UX:
- Active view / Archived view (two modes)
- "Archive" button moves lead to archive view

Proposed UX:
- Single unified lead view with filters
- Status: active | archived | deleted
- Filter buttons: [Active] [Archived] [Show deleted]
- "Archive" button changes status, doesn't move view
```

#### 4. Outreach Integration from My Leads
```
Current: "Start outreach" button exists but routes nowhere
Proposed: "Start outreach" → opens campaign/draft creation WITH that business pre-selected

Pattern: Outreach Queue is created *from* My Leads, not a separate destination
```

---

## What Phase 0 Does NOT Change

- ✅ Database schema (leads table stays as-is)
- ✅ Commercial Intelligence system (already fixed)
- ✅ Discover/Scraper functionality
- ✅ Pipeline logic
- ✅ Outreach Queue logic
- ✅ Email sending

Phase 0 changes:
- Navigation order
- Module accessibility
- UI terminology clarity
- Button routing

---

## Architectural Principle Reinforcement

After Phase 0, the system should clearly enforce:

1. **My Leads is the permanent repository** — all leads exist there by default
2. **All modules reference, never own** — Outreach Queue, Pipeline, etc. reference businesses, don't create/delete them
3. **Status is the only "movement"** — businesses change status (active → archived → deleted), they don't move between modules
4. **Single entry point** — users go to My Leads first to understand their business portfolio
5. **Actions reference businesses** — "Start outreach for this business" not "Move business to outreach queue"

---

## Success Metrics for Phase 0

After implementation, audit again for:
- ✅ New users immediately navigate to My Leads as first conscious action
- ✅ "Archive" is clearly a status change, not deletion
- ✅ All users (not just admin) can access the authoritative business repository
- ✅ Outreach Queue shows businesses by their details (not abstract references)
- ✅ Pipeline references businesses, not "leads" as separate entities
- ✅ Zero ambiguity about where a business record lives

---

## Next Steps

1. **Approve this audit** — confirm principle and findings
2. **Approve recommended changes** — verify Phase 0 scope doesn't exceed intent
3. **Create ADR (Architecture Decision Record)** — document why My Leads is repository, why leads table isn't renamed
4. **Produce implementation plan** — detailed UI/nav changes for Phase 0
5. **Begin Phase 0 implementation** — navigation, accessibility, UI clarity

