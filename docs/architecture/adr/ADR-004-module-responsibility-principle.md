# ADR-004: Module Responsibility Principle

**Status:** ACCEPTED  
**Date:** 2026-07-07  
**Related:** [[ADR-001]], [[ADR-002]]

---

## Context

ALPA has multiple functional areas: Discovery, Business Management, Outreach, Pipeline, and future AI. Without clear responsibility boundaries, modules blur together, creating:
- Unclear ownership (who fixes bugs?)
- Responsibility duplication (features in multiple places)
- Confused workflows (users don't know which module for which action)

---

## Problem

The system needed clarity on:
- What each module does
- What each module does NOT do
- How modules interact
- What data lives where

---

## Decision

**Modules are workspaces, not containers. Modules perform work on the repository; they don't own the repository.**

Core principle: Each module has a clear, singular responsibility. Businesses remain in the repository ([[ADR-001]]) regardless of which module operates on them.

---

## Module Responsibilities

### Dashboard
**Role:** Command center and guiding surface  
**Responsibility:** Overview of user's status and next best action  
**Owns:** None (reads from all modules)  
**References:** Businesses, campaigns, usage metrics  
**Provides:** Navigation, status summary, next action recommendation  

**Does NOT:**
- Create or modify businesses
- Handle outreach
- Manage pipeline
- Perform discovery

---

### Discover (Scraper)
**Role:** Business acquisition  
**Responsibility:** Find businesses matching user criteria  
**Owns:** Search queries, search results  
**References:** Creates new businesses in repository  
**Provides:** Search interface, lead quality assessment  

**Does:**
- Run searches (Serper, Google APIs)
- Enrich results with basic info (website, email, phone)
- Create lead records in `leads` table
- Enqueue CI processing for new leads
- Show search results to user

**Does NOT:**
- Manage business records after creation
- Perform outreach
- Track pipeline
- Archive or delete businesses

---

### My Leads (Repository Workspace)
**Role:** Permanent business repository and qualification workspace  
**Responsibility:** Review, organize, qualify, and manage all discovered businesses  
**Owns:** Business records in `leads` table  
**References:** Displays CI results, campaign history, pipeline status  
**Provides:** Unified business view, search, filtering, bulk actions, CI integration  

**Does:**
- Display all discovered businesses
- Show business details and contact info
- Display CI enrichment status and results
- Show relationship progression (discovered → validated → ready → contacted → etc.)
- Archive/restore businesses
- Delete businesses (soft-delete)
- Bulk export businesses
- Re-trigger CI processing
- Route to outreach creation

**Does NOT:**
- Send emails
- Create pipeline stages
- Store drafts or templates
- Search for new businesses (that's Discover)

---

### Outreach Queue
**Role:** Campaign execution and draft management  
**Responsibility:** Create and manage outreach campaigns targeting businesses  
**Owns:** Drafts, campaign templates, approval workflow  
**References:** Specific businesses from My Leads  
**Provides:** Draft creation, personalization, approval, batch sending  

**Does:**
- Create campaign drafts for selected businesses
- Personalize email content per business
- Store drafts and campaign history
- Provide approval/rejection workflow
- Send approved campaigns
- Track open/reply metrics

**Does NOT:**
- Manage business records
- Create new businesses
- Modify business fields
- Manage pipeline stages
- Archive or delete businesses

---

### Pipeline (Kanban)
**Role:** Outcome tracking and funnel management  
**Responsibility:** Track businesses through sales stages and outcomes  
**Owns:** Pipeline stage assignments, stage metadata  
**References:** Specific businesses from My Leads  
**Provides:** Visual stage management (Kanban view), stage transitions, outcome tracking  

**Does:**
- Display businesses by pipeline stage
- Allow drag-drop stage transitions
- Track stage timestamps and transitions
- Provide funnel analytics
- Recommend next actions per stage
- Close won/lost opportunities

**Does NOT:**
- Create new businesses
- Modify business contact info
- Create campaigns or drafts
- Delete businesses from repository
- Manage outreach messages

---

### Future AI (Autonomous Agent)
**Role:** Autonomous business discovery and preparation  
**Responsibility:** Continuously find and prepare outreach opportunities  
**Owns:** Autonomous search schedules, AI discovery settings  
**References:** Creates businesses in My Leads, stages them for outreach  
**Provides:** Hands-off prospecting, automatic lead qualification  

**Does:**
- Run scheduled searches autonomously
- Create businesses in My Leads
- Pre-qualify businesses (ready/not ready)
- Prepare draft campaigns
- Suggest optimal sending times

**Does NOT:**
- Send without approval
- Modify archived businesses
- Delete businesses
- Bypass approval workflow

---

## Data Flow Diagram

```
User Actions
    ↓
┌─────────────────────────────────────────┐
│ Discover: Find businesses               │ ← User searches
│ Creates: leads records                  │
│ Enqueues: CI processing                 │
└─────────────────────┬───────────────────┘
                      ↓
          ┌─────────────────────┐
          │ My Leads Repository │ ← Single source of truth
          │ All businesses live │   (leads table)
          │ here, always        │
          └────────┬────────────┘
                   ↑ ↓ ↑ ↓
        ┌──────────┘ └──────────┐
        ↓                       ↓
   ┌────────────┐         ┌──────────┐
   │ Outreach   │         │ Pipeline │
   │ References │         │ References
   │ for drafts │         │ for stages
   └────────────┘         └──────────┘
```

Key principle: **All arrows point TO the repository; none point away.**

---

## Module Interaction Rules

### ✅ DO: Reference Businesses in Repository

```typescript
// ✅ Good: Outreach Queue selects a business and creates draft
const business = await fetchBusiness(businessId)
const draft = await createDraft(businessId, template)
// Business stays in repository; draft is just metadata for outreach
```

### ✅ DO: Update Business Fields Only from My Leads

```typescript
// ✅ Good: My Leads is where business contact info is maintained
await updateBusiness(businessId, { email: 'new@email.com' })
// Outreach and Pipeline see the update; no separate updates needed
```

### ❌ DON'T: Create Business Records Outside My Leads

```typescript
// ❌ Bad: Outreach shouldn't create new businesses
const business = await createBusiness({ name: 'Acme' })
// This breaks [[ADR-001]]; must go through Discover or manual import
```

### ❌ DON'T: Maintain Parallel Business State

```typescript
// ❌ Bad: Each module storing its own copy of business data
// Outreach stores: { id, name, email, domain, status }
// Pipeline stores: { id, name, stage, close_reason }
// If email changes in My Leads, others don't see it
```

### ✅ DO: Subscribe to Repository Changes

```typescript
// ✅ Good: When My Leads updates business, others see it
// Business updated → My Leads re-queries DB → updates UI
// Outreach sees new data next time it fetches draft targets
// Pipeline sees updated business fields in Kanban view
```

---

## Responsibility Clarity Matrix

|  | Dashboard | Discover | My Leads | Outreach | Pipeline | Future AI |
|---|-----------|----------|----------|----------|----------|-----------|
| **Create businesses** | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Delete/archive** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Update business fields** | ❌ | ✅ (on import) | ✅ | ❌ | ❌ | ✅ |
| **Store drafts** | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Manage campaigns** | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Manage pipeline stage** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Send emails** | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Query all data** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Consequences

### Positive

✅ **Clear ownership** — Know which module to modify for each concern  
✅ **Reduced duplication** — No "keep multiple copies in sync" burden  
✅ **Easier debugging** — Query the repository; it's authoritative  
✅ **Scalable interaction** — Modules don't need complex synchronization  
✅ **Testable boundaries** — Can test each module independently  
✅ **Supports future modules** — New modules naturally fit this pattern  

### Negative

❌ **Cross-module changes need coordination** — Can't change one module in isolation  
❌ **Shared responsibility for data integrity** — All modules must respect repository principle  
❌ **Query complexity** — Must join across tables sometimes  

---

## Violations to Avoid

### Violation 1: Module Creates Its Own Entities
❌ Outreach creates "lead" records for its drafts  
✅ Outreach references businesses; drafts are separate  

### Violation 2: Parallel Status Tracking
❌ Pipeline stages also tracked in Outreach Queue  
✅ Single pipeline_stage field in businesses; Pipeline is workspace to view/update it  

### Violation 3: Duplicated Business Copies
❌ Discover returns results; Outreach imports them again  
✅ Discover creates in My Leads; Outreach references from there  

### Violation 4: Module "Moves" Businesses
❌ "Archive from Outreach" moves business somewhere  
✅ Archive is status change in My Leads; Outreach just references it  

---

## Future Extensions

As ALPA evolves, new modules will follow same pattern:

**Conversations** (Phase 1)
- Owns: Email threads, message history
- References: Specific businesses
- Pattern: Conversation links to business; not owned by Outreach

**Campaigns** (Phase 2)
- Owns: Campaign definitions, member rules
- References: Businesses via Campaign Membership join table
- Pattern: Campaign references businesses; not the reverse

**Opportunities** (Phase 3)
- Owns: Deal records, outcomes
- References: Businesses, Conversations
- Pattern: Opportunity is business + context, not standalone entity

**Activity Log** (Phase 4)
- Owns: Audit records (immutable)
- References: Businesses, actions
- Pattern: Append-only log of what happened to businesses

---

## Implementation Guidelines

When building new features:
1. Identify the primary entity (usually a business)
2. Place it in My Leads repository (if not already there)
3. Have your module reference, never own
4. Read from My Leads for latest state
5. Update My Leads when appropriate
6. Trust that other modules will see your updates

---

## Related Architecture

- [[ADR-001]] — My Leads owns the businesses; modules reference
- [[ADR-002]] — Database is authoritative; modules query it
- [[ADR-003]] — CI is enhancement to business, not standalone

---

**Approved by:** Product Architecture  
**Approval date:** 2026-07-07
