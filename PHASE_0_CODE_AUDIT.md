# Phase 0 Code Audit: Architectural Violations

**Date:** 2026-07-07  
**Scope:** Review existing codebase for violations of [[ADR-001]], [[ADR-002]], [[ADR-003]], [[ADR-004]]  
**Status:** AUDIT ONLY (no fixes implemented yet)

---

## Executive Summary

Codebase has **12 significant architectural violations** across 5 categories:

| Category | Count | Severity | Example |
|----------|-------|----------|---------|
| Status-based "movement" | 4 | HIGH | `moveToPipeline()` function |
| Module responsibility blur | 3 | HIGH | Scraper updating `status: 'pipeline'` |
| Terminology inconsistency | 3 | MEDIUM | Mixed "leads" vs "businesses" |
| Duplicate module views | 2 | HIGH | Leads Inbox and Lead Library |

---

## Violations Detailed

### Category 1: Status-Based "Movement" (Violates ADR-001)

Violation: Using `status` field to indicate which module a lead belongs to, suggesting leads "move" between modules.

#### Violation 1A: `moveToPipeline()` function
**Location:** `app/dashboard/leads/LeadsPageClient.tsx:200+`

```typescript
async function moveToPipeline(ids: string[]) {
  if (ids.length === 0) return
  if (pipelineLocked) {
    setFeatureLockContent(PIPELINE_LOCK_CONTENT)
    setShowFeatureLock(true)
    return
  }

  const { error } = await supabase
    .from('leads')
    .update({ status: 'pipeline' })  // ← VIOLATION: status = 'pipeline' implies movement
    .in('id', ids)
    
  // ...
}
```

**Problem:** 
- Function name "moveToPipeline" implies leads leave Leads Inbox
- Updates `status: 'pipeline'` as if leads are now "in" pipeline module
- Contradicts [[ADR-001]]: leads don't move; they stay in repository
- Contradicts [[ADR-004]]: Pipeline module should reference businesses, not own them

**Correct Semantic:**
- `updatePipelineStageForBusiness()` or just update `pipeline_stage` field
- Status field should track lead lifecycle (inbox, contacted, archived), not module ownership

**Frequency:** Called when user clicks "Move to pipeline" button; affects workflow UX

---

#### Violation 1B: Scraper updates `status: 'pipeline'`
**Location:** `app/dashboard/scraper/page.tsx:~1350+`

```typescript
await supabase
  .from('leads')
  .update({ status: 'pipeline' })  // ← VIOLATION: Scraper shouldn't determine status
  .eq('id', id)

// Optimistic update
setPreviewLeads(
  prev.map((lead) => 
    lead.id === id ? { ...lead, status: 'pipeline' } : lead
  )
)
```

**Problem:**
- Scraper (Discovery module) updates status to 'pipeline'
- Violates [[ADR-004]]: Discover only acquires; doesn't manage pipeline
- Creates confusion: who owns pipeline status? Discover or Pipeline module?
- UI hint `inPipeline={lead.status === 'pipeline'}` reinforces wrong semantic

**Correct Semantic:**
- Scraper only creates businesses with default status (inbox)
- User decides pipeline membership via Pipeline module, not Scraper

---

#### Violation 1C: Leads Inbox filters by status
**Location:** `app/dashboard/leads/LeadsPageClient.tsx:177`

```typescript
const { data } = await supabase
  .from('leads')
  .select('*')
  .eq('user_id', user.id)
  .eq('status', 'inbox')  // ← VIOLATION: Creating "inbox view" via status filter
  .order('created_at', { ascending: false })
```

**Problem:**
- "Leads Inbox" module only shows leads with `status = 'inbox'`
- Suggests leads "leave" inbox when status changes
- Creates semantic confusion: is Inbox a module or a status?
- Contradicts [[ADR-001]]: My Leads should show ALL businesses regardless of status

**Correct Semantic:**
- Leads Inbox should show all leads
- Status filter should be UI-level (My Leads provides this), not module-level
- Or: retire Leads Inbox entirely (consolidate into My Leads)

---

#### Violation 1D: Lead Library status updates
**Location:** `app/dashboard/library/page.tsx:~150+`

```typescript
async function updateStatus(id: string, status: 'inbox' | 'pipeline' | 'contacted') {
  if (!currentUserId || isGuest) return
  if (status === 'pipeline' && pipelineLocked) return

  const { error } = await supabase
    .from('leads')
    .update({ status })  // ← VIOLATION: Library allows arbitrary status changes
    .eq('id', id)
    .eq('user_id', currentUserId)
}
```

**Problem:**
- Lead Library allows changing lead status
- Creates ambiguity: which module should update status?
- Multiple entry points for status changes (Scraper, Leads Inbox, Lead Library)
- Violates [[ADR-004]]: unclear responsibility ownership

---

### Category 2: Module Responsibility Blur (Violates ADR-004)

Violation: Modules have unclear or overlapping responsibilities.

#### Violation 2A: Scraper owns business contact info during import
**Location:** `app/dashboard/scraper/page.tsx` (full page file, ~2000 lines)

**Problem:**
- Scraper accepts and modifies business data during import
- Functions like `addPreviewLeadToPipeline()` manage business state
- UI components like LeadCard used in Scraper suggest Scraper is a workspace
- Scraper determines initial values for all business fields

**Current Semantic:**
```
Scraper = Find + Manage businesses from discovery
Pipeline = Also manage businesses (status changes)
My Leads = Also manage businesses (archive/delete)
```

**Correct Semantic (per [[ADR-004]]):**
```
Scraper = Find + Create businesses (initial import only)
My Leads = Manage all businesses (status, archive, delete, update)
Pipeline = Reference businesses + update pipeline_stage only
```

---

#### Violation 2B: Multiple modules can update business status
**Location:** Scraper (line ~1350), Leads Inbox (line ~200), Lead Library (line ~150)

**Problem:**
- 3 different code paths can update business `status` field
- No clear owner; any module might update
- Risk of conflicts or inconsistent updates
- Violates [[ADR-001]]: single point of update

**Correct Pattern:**
- Only My Leads (or My Leads API) updates business status
- Other modules request status changes via My Leads
- Or: Scraper only sets initial status during creation; all updates go through My Leads

---

#### Violation 2C: Outreach Queue implied ownership via naming
**Location:** `app/api/outreach/` (naming convention)

**Problem:**
- Folder naming suggests "Outreach" owns something
- Creates mental model: "Outreach has its own businesses"
- While code is actually correct (references businesses), naming contradicts [[ADR-004]]

**Note:** This is a naming/documentation issue, not functional code violation

---

### Category 3: Terminology Inconsistency (Violates Design Coherence)

Violation: Uses both "lead" and "business" terminology interchangeably, creating confusion.

#### Violation 3A: Scraper mixes terminology
**Location:** `app/dashboard/scraper/page.tsx` throughout

Mixed usage:
```typescript
function formatLeadDiscoveryLine(lead: TrialLead, fallbackLocation: string) {
  // Function named with "Lead" but operates on "Business"
  return `✓ Business found — ${location}`  // ← says "Business"
}

enqueueLog(`✓ Contact found for ${lead.company_name || 'business'}`)
// ← sometimes "lead", sometimes "business"
```

**Problem:**
- Same entity called both "lead" and "business"
- Inconsistent terminology in logs, function names, variable names
- Violates [[ADR-001]]: unclear what a "lead" vs "business" is

**Correct Semantic:**
- Internal: always "business"
- External (user-facing): can be "business" or "prospect" (discovery language)
- Never mix both internally

---

#### Violation 3B: My Leads references "lead" everywhere
**Location:** `app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx`

**Problem:**
- Type name: `MyLeadsLead`
- Function `getLeadQuality()`, `isArchivedLead()`, `hasContactActivity()`
- Comments reference "leads" throughout
- Variable names: `archivedLeadIds`, `selectedLeadIds`

**Note:** This is acceptable since My Leads *is* currently the authoritative module. But should align with "business" terminology as architectural clarity improves.

---

#### Violation 3C: Dashboard copy uses different terminology per module
**Location:** `app/dashboard/page.tsx`

```typescript
// Line 135
return {
  title: 'Start by discovering your first prospects.',  // ← "prospects"
  // ...
}

// Line 155
return {
  title: 'You have leads ready. Export them or create a campaign.',  // ← "leads"
  // ...
}
```

**Problem:**
- Same entity called "prospects", "leads", "businesses" in different places
- User sees different terminology depending on which module they view
- Violates coherence principle: same entity should have same name

---

### Category 4: Duplicate Module Views (Violates ADR-001)

Violation: Multiple modules show the same data, suggesting multiple sources of truth.

#### Violation 4A: Leads Inbox vs My Leads
**Location:** 
- `app/dashboard/leads/page.tsx` (Leads Inbox)
- `app/dashboard/my-leads/page.tsx` (My Leads)

**Problem:**
- Both pages query `leads` table
- Both show business data
- Leads Inbox shows `status = 'inbox'` only
- My Leads shows all leads regardless of status
- Navigation shows both; user doesn't know which to use

**Architectural Issue:**
- Suggests `status = 'inbox'` is a business state (violates ADR-001)
- Creates confusion: "Where do my real businesses live?"
- Leads Inbox is essentially a filtered view of a status field

**Design Implication:**
- Should consolidate into single view (My Leads with filtering)
- Or clarify: Leads Inbox is for new, unreviewed leads; My Leads is comprehensive

---

#### Violation 4B: Lead Library vs My Leads
**Location:**
- `app/dashboard/library/page.tsx` (Lead Library)
- `app/dashboard/my-leads/page.tsx` (My Leads)

**Problem:**
- Both pages query `leads` table
- Lead Library positions itself as "search and revisit full lead history"
- My Leads also supports search
- Duplicate functionality suggests multiple sources of truth

**Design Implication:**
- Lead Library features should be subsumed into My Leads search
- Lead Library should be deprecated or repurposed

---

### Category 5: Navigation & UX Implications (Violates Design Intent)

Violation: Navigation order and UX flows contradict intended architecture.

#### Violation 5A: Navigation doesn't show acquisition → management flow
**Location:** `components/dashboard/DashboardShell.tsx`

```
Current order:
- Dashboard
- My Leads [admin-only, accent-highlighted]
- Leads Inbox
- Discover [Scraper]
- Lead Library
- Pipeline
- Outreach Queue
```

**Problem:**
- User's actual journey: Discover → My Leads → Outreach → Pipeline
- Navigation shows: Dashboard → My Leads → Discover (wrong order)
- Suggests My Leads is optional ("let me look for leads first") instead of foundational

**Design Implication:**
- Navigation should reflect user journey, not arbitrary order
- Should make clear path: Discover (find) → My Leads (manage) → Outreach (act) → Pipeline (track)

---

#### Violation 5B: "Start outreach" button routes nowhere
**Location:** `app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx:1237`

```typescript
<button
  onClick={(e) => e.stopPropagation()}
  className="flex-1 px-3 py-2 text-xs font-medium text-blue-300 ..."
>
  Start outreach
</button>
```

**Problem:**
- Button says "Start outreach" but doesn't navigate anywhere
- Violates [[ADR-004]]: should link from My Leads → Outreach
- User doesn't know how to take action on a business

---

#### Violation 5C: Comments contradicting architecture
**Location:** Multiple locations

Examples:

```typescript
// app/dashboard/my-leads/page.tsx
// CANONICAL LEAD SELECTION
// Matches Lead Library exactly to ensure consistent totals across ALPA
// ← Why match Lead Library? If they're the same, should consolidate.

// app/dashboard/leads/LeadsPageClient.tsx (Leads Inbox)
// This is the Inbox; leads come here after discovery
// ← Suggests leads "flow" to Inbox (movement), not stay in repository

// app/dashboard/kanban/page.tsx
// Pipeline view of leads
// ← Treats Pipeline as another "view" of leads, not just a status attribute
```

**Problem:**
- Comments suggest leads move between modules
- Reinforce wrong architectural model for future maintainers

---

## Violations Matrix

| Violation | Violates | Severity | Frequency | Risk |
|-----------|----------|----------|-----------|------|
| moveToPipeline() | ADR-001, ADR-004 | HIGH | 1 per status change | User confusion |
| Scraper sets status | ADR-001, ADR-004 | HIGH | During import | Data inconsistency |
| Leads Inbox filters by status | ADR-001 | HIGH | Page load | Duplicate view |
| Lead Library status updates | ADR-004 | HIGH | Admin actions | Unclear ownership |
| Status-based movement pattern | ADR-001, ADR-004 | HIGH | Throughout | Architectural incoherence |
| Terminology "lead" vs "business" | Design | MEDIUM | Throughout | User confusion |
| Duplicate Inbox/Library views | ADR-001 | HIGH | On nav | Module confusion |
| Navigation order | [[ADR-004]] | MEDIUM | Session start | User disorientation |
| "Start outreach" orphan button | [[ADR-004]] | MEDIUM | Click attempt | UX dead-end |
| Comments contradicting arch | Maintainability | LOW | Code review | Future mistakes |

---

## Impact Assessment

### Immediate Impact (User-Facing)
- Users don't know where business data lives (Inbox vs Library vs My Leads)
- "Move to Pipeline" button suggests businesses leave their original location
- Workflow isn't clear (what's the next step after discovery?)
- "Start outreach" button doesn't work

### Technical Impact
- Multiple code paths update business status (no single source)
- Scraper has responsibility beyond acquisition
- Unclear module boundaries make testing harder
- Adding new features requires deciding which module "owns" the change

### Scalability Impact (At 100k+ businesses)
- Status-based filtering becomes expensive (no index on status for inbox)
- Multiple modules writing to same fields = race condition risk
- User confusion about "where are my businesses?" becomes critical

---

## Recommended Fixes (Phase 0.1)

**Phase 0.1 focuses on UI/navigation clarity without changing data schema.**

Priority order:

1. **HIGH:** Rename `moveToPipeline()` → `updatePipelineStageForBusiness()` + update UX copy
2. **HIGH:** Remove Scraper's ability to set status; only allow creation
3. **HIGH:** Consolidate Leads Inbox + Lead Library views into My Leads filtering
4. **HIGH:** Fix "Start outreach" button routing
5. **MEDIUM:** Standardize terminology (decide: "lead" or "business" internally)
6. **MEDIUM:** Reorder navigation to show discovery → management flow
7. **MEDIUM:** Update comments to align with [[ADR-001]] model
8. **LOW:** Update copy to avoid "move" language; use "status change" instead

---

## What Should NOT Change in Phase 0.1

- ❌ Database schema
- ❌ Status field storage (still used for filtering, just different semantic)
- ❌ Existing lead data
- ❌ Outreach/Pipeline logic

---

## Next Steps

1. **Review this audit** — Confirm findings are accurate
2. **Approve Phase 0.1 scope** — Which fixes to prioritize
3. **Implement Phase 0.1** — UI/copy/routing changes (low risk)
4. **Measure impact** — Do users understand workflow better?
5. **Plan Phase 1** — Address remaining violations (database schema, module boundaries)

---

**Audit completed:** 2026-07-07  
**Status:** Ready for review and recommendation discussion

