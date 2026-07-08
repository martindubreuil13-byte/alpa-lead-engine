# Phase 0 Implementation Plan: My Leads as Repository

**Goal:** Deliver architectural clarity that My Leads is the permanent repository, without database schema changes or breaking existing functionality.

**Timeline:** 1 sprint (1 week)  
**Risk Level:** LOW (UI-only changes; no data schema changes; fully reversible)

---

## Scope Overview

### What Phase 0 Delivers

1. **Navigation Restructuring** — Reorder modules; remove duplicates
2. **My Leads Accessibility** — Remove admin-only restriction
3. **UI Terminology Cleanup** — Archive is status, not movement
4. **Outreach Integration** — "Start outreach" button routes correctly
5. **Search Consolidation** — Lead Library merges into My Leads

### What Phase 0 Does NOT Change

- ❌ Database schema
- ❌ `leads` table name
- ❌ Lead creation flow
- ❌ Commercial Intelligence system
- ❌ Outreach/Pipeline logic
- ❌ Email sending

---

## Detailed Implementation Tasks

### Task 1: Navigation Restructuring (2-3 hours)

**File:** `components/dashboard/DashboardShell.tsx`

**Current Order:**
```
Dashboard
├─ My Leads [admin-only, accent]
├─ Leads Inbox
├─ Discover
├─ Lead Library
├─ Pipeline
├─ Outreach Queue
├─ Templates
└─ Settings
```

**New Order:**
```
Dashboard
├─ Discover [icon: Rocket]
├─ My Leads [icon: UserRoundSearch, accent, NO admin-only]
├─ Pipeline [icon: Columns3]
├─ Outreach Queue [icon: Zap]
├─ Templates [icon: FileText]
└─ Settings [icon: Settings]
```

**Changes:**
```typescript
// BEFORE
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  {
    href: '/dashboard/my-leads',
    label: 'My Leads',
    icon: UserRoundSearch,
    adminOnly: true,  // ← REMOVE THIS
    accent: true,
    description: 'A unified workspace for reviewing, filtering, and managing every lead.',
    benefit: 'My Leads brings the inbox, library, and lifecycle view into one future-ready workspace.',
  },
  { href: '/dashboard/leads', label: 'Leads Inbox', icon: Inbox },  // ← DELETE THIS
  {
    href: '/dashboard/kanban',
    label: 'Pipeline',
    icon: Columns3,
    // ... move up in order
  },
  { href: '/dashboard/scraper', label: 'Discover', icon: Rocket },  // ← MOVE UP
  {
    href: '/dashboard/library',
    label: 'Lead Library',  // ← DELETE THIS
    icon: BookOpenText,
  },
  // ... rest

// AFTER
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/dashboard/scraper', label: 'Discover', icon: Rocket },
  {
    href: '/dashboard/my-leads',
    label: 'My Leads',
    icon: UserRoundSearch,
    accent: true,
    description: 'The permanent repository of all your businesses. Review, qualify, and organize here.',
    benefit: 'Every business you discover lives here. All other modules reference My Leads.',
  },
  {
    href: '/dashboard/kanban',
    label: 'Pipeline',
    icon: Columns3,
    // ...
  },
  {
    href: '/dashboard/outreach',
    label: 'Outreach Queue',
    icon: Zap,
    adminOnly: true,
    // ...
  },
  { href: '/dashboard/templates', label: 'Templates', icon: FileText, feature: 'templates' },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings, lockedOnFree: true },
]
```

**Impact:**
- ✅ Discover is entry point to business workflow
- ✅ My Leads is primary workspace (not admin-only)
- ✅ Pipeline and Outreach follow naturally
- ✅ Leads Inbox and Lead Library removed from nav
- ✅ New users see clearer journey

---

### Task 2: Remove Admin-Only from My Leads (1 hour)

**File:** `components/dashboard/DashboardShell.tsx`

**Change:**
```typescript
// BEFORE
{
  href: '/dashboard/my-leads',
  label: 'My Leads',
  icon: UserRoundSearch,
  adminOnly: true,  // ← REMOVE
  accent: true,
}

// AFTER
{
  href: '/dashboard/my-leads',
  label: 'My Leads',
  icon: UserRoundSearch,
  accent: true,
  // adminOnly field removed
}
```

**Permission Check:**
- Keep access control on the `/dashboard/my-leads` page itself
- Check in `app/dashboard/my-leads/page.tsx`: verify user.id is set
- Free users can access My Leads but with feature limits (search credits, daily email limit)
- No need to change auth logic; just remove nav restriction

---

### Task 3: Update My Leads Page Copy (1 hour)

**File:** `app/dashboard/my-leads/page.tsx` and `MyLeadsWorkspaceClient.tsx`

**Changes:**

a) Page description/documentation
```typescript
// BEFORE
// CANONICAL LEAD SELECTION
// Matches Lead Library exactly to ensure consistent totals across ALPA
const LEAD_SELECT = '...';

// AFTER
// MY LEADS REPOSITORY SELECTION
// The permanent repository of all discovered businesses
// All other modules reference these businesses
const LEAD_SELECT = '...';
```

b) Update My Leads component comments
```typescript
// BEFORE
export type MyLeadsLead = LifecycleLead & {
  // leads with lifecycle tracking

// AFTER
/**
 * MyLeadsLead represents a Business in the repository.
 * All discovered businesses live here.
 * Other modules (Outreach, Pipeline, etc.) reference these via foreign keys.
 */
export type MyLeadsLead = LifecycleLead & {
```

---

### Task 4: Archive UI Clarity (2-3 hours)

**File:** `MyLeadsWorkspaceClient.tsx`

**Current Issue:** Separate "Active" and "Archived" view modes suggest movement.

**Change 1: Update Tab Naming**
```typescript
// BEFORE
<button onClick={() => setViewMode('active')} ...>Active</button>
<button onClick={() => setViewMode('archived')} ...>Archived {count}</button>

// AFTER
<button onClick={() => setViewMode('active')} ...>Active</button>
<button onClick={() => setViewMode('archived')} ...>Archived {count}</button>
// ^ Keep names the same, but update behavior
```

**Change 2: Update Archive Button Copy**
```typescript
// BEFORE
<button onClick={() => handleArchive(lead.id)}>Archive</button>

// AFTER
<button onClick={() => handleArchive(lead.id)}>Archive (status change)</button>
// or just keep "Archive" but update tooltip:
// Tooltip: "Archive this business. It will remain in your repository with archived status."
```

**Change 3: Update Delete Confirmation Copy**
```typescript
// BEFORE
<p>This lead will be permanently deleted and cannot be recovered.</p>

// AFTER
<p>This business will be soft-deleted and hidden for 30 days before permanent removal.</p>
<p>You can restore it anytime in the Archived view.</p>
```

**Change 4: Update Archived Lead Recommendation**
```typescript
// BEFORE
const rec = {
  title: 'This lead is archived.',
  action: "Restore it if you'd like to re-engage.",
}

// AFTER
const rec = {
  title: 'This business is archived.',
  action: 'It remains in your repository. Restore its status to active whenever you\'re ready to re-engage.',
}
```

---

### Task 5: "Start Outreach" Button Routing (2-3 hours)

**File:** `MyLeadsWorkspaceClient.tsx`

**Current Issue:** Button says "Start outreach" but doesn't route anywhere.

**Current Code:**
```typescript
<button
  onClick={(e) => e.stopPropagation()}
  className="flex-1 px-3 py-2 text-xs font-medium text-blue-300 hover:text-blue-200 hover:bg-blue-500/[0.08] rounded-lg transition"
>
  Start outreach
</button>
```

**Updated Code:**
```typescript
const router = useRouter()

<button
  onClick={(e) => {
    e.stopPropagation()
    router.push(`/dashboard/outreach?business_id=${lead.id}`)
  }}
  className="flex-1 px-3 py-2 text-xs font-medium text-blue-300 hover:text-blue-200 hover:bg-blue-500/[0.08] rounded-lg transition"
>
  Start outreach
</button>
```

**Outreach Queue Changes** (`app/dashboard/outreach/page.tsx`):
```typescript
// Add query param handling to pre-select business
const params = useSearchParams()
const selectedBusinessId = params.get('business_id')

useEffect(() => {
  if (selectedBusinessId) {
    // Pre-select this business for campaign creation
    // Show it in the campaign builder
  }
}, [selectedBusinessId])
```

---

### Task 6: Leads Inbox Redirect (1 hour)

**File:** `app/dashboard/leads/page.tsx`

**Current:** Leads Inbox page still exists and works.

**Approach:** Add redirect with user messaging

```typescript
// app/dashboard/leads/page.tsx

import { redirect } from 'next/navigation'

export default function LeadsInboxPage() {
  // Redirect users to My Leads with context message
  // Store a one-time message: "Leads Inbox has been consolidated into My Leads"
  redirect('/dashboard/my-leads')
}

// Or if we want to keep a bridge page for a few days:
export default function LeadsInboxPage() {
  return (
    <div className="space-y-6 pb-10">
      <div className="rounded-xl border border-cyan-200/14 bg-cyan-300/[0.055] p-6">
        <h1 className="text-2xl font-semibold text-white">Leads Inbox has moved</h1>
        <p className="mt-2 text-sm text-slate-400">
          We've consolidated all lead views into <strong>My Leads</strong>, the permanent repository for all your businesses.
        </p>
        <Link href="/dashboard/my-leads" className="btn-primary-gold mt-4">
          Go to My Leads
        </Link>
      </div>
    </div>
  )
}
```

---

### Task 7: Lead Library Merge (2-3 hours)

**Current:** Lead Library has search + historical view

**Approach:** Add search/filter to My Leads; redirect Lead Library page

**In MyLeadsWorkspaceClient.tsx:**
```typescript
// Search already exists; add filter options:
const filteredLeads = useMemo(() => {
  const normalizedSearch = search.trim().toLowerCase()
  const byView = leadsWithMetadata.filter((lead) => { ... })
  
  // Already has CI filter; can extend with:
  // - Date range filter
  // - Industry filter (from CI data)
  // - Location filter
  // - Status filter
  
  // For now, existing search + view toggle is sufficient
}, [search, leadsWithMetadata, viewMode, archivedLeadIds, deletedLeadIds, showCompletedOnly])
```

**Lead Library Page Redirect:**
```typescript
// app/dashboard/library/page.tsx

import { redirect } from 'next/navigation'

export default function LeadLibraryPage() {
  redirect('/dashboard/my-leads')
}
```

---

### Task 8: Update Dashboard Copy (1 hour)

**File:** `app/dashboard/page.tsx`

**Update Next Best Step Logic:**
```typescript
// BEFORE
const nextStep = useMemo(() => {
  if (data.myLeads === 0) {
    return {
      title: 'Start by discovering your first prospects.',
      detail: 'Run a focused search, review the results, and save the leads worth contacting.',
      href: '/dashboard/scraper',
      cta: 'Find leads',
    }
  }
  
  if (readyCampaigns > 0) {
    return {
      title: 'You have emails ready for review.',
      detail: 'Drafts or approved messages already exist. Review them before sending.',
      href: '/dashboard/leads',  // ← WRONG PLACE
      cta: 'Review leads',
    }
  }
  // ...

// AFTER
const nextStep = useMemo(() => {
  if (data.myLeads === 0) {
    return {
      title: 'Start by discovering your first businesses.',
      detail: 'Use Discover to run a focused search. Your saved businesses go into My Leads.',
      href: '/dashboard/scraper',
      cta: 'Discover businesses',  // Better copy
    }
  }
  
  if (readyCampaigns > 0) {
    return {
      title: 'You have outreach drafts ready for review.',
      detail: 'Review your campaign drafts in Outreach Queue and approve them to send.',
      href: '/dashboard/outreach',  // ← CORRECT PLACE
      cta: 'Review campaigns',
    }
  }
  
  if ((data.sentCampaigns || 0) > 0) {
    return {
      title: 'Check your business repository and campaign results.',
      detail: 'Go to My Leads to review your businesses. Check Outreach for sent campaign status.',
      href: '/dashboard/my-leads',  // ← MAIN PLACE
      cta: 'Go to My Leads',
    }
  }

  return {
    title: 'You have businesses in your repository. Next step: create a campaign.',
    detail: 'Use My Leads to find businesses ready for outreach. Select one and start a campaign.',
    href: '/dashboard/my-leads',
    cta: 'Go to My Leads',
  }
}, [data])
```

---

### Task 9: Update Hero Buttons (30 min)

**File:** `app/dashboard/page.tsx` in `HeroSection`

```typescript
// BEFORE
<Link href="/dashboard/scraper" className="btn-primary-gold">
  Find new leads
  <ArrowRight className="h-4 w-4" />
</Link>
<Link href="/dashboard/leads" className="...">
  My Leads
</Link>

// AFTER
<Link href="/dashboard/scraper" className="btn-primary-gold">
  Discover businesses
  <ArrowRight className="h-4 w-4" />
</Link>
<Link href="/dashboard/my-leads" className="...">
  My Leads (Repository)  // Make it clear this is the main workspace
</Link>
```

---

### Task 10: Update Outreach Queue Navigation Context (1-2 hours)

**File:** `app/dashboard/outreach/page.tsx`

**Add breadcrumb/context:**
```typescript
// Add context that shows this is an action *from* My Leads, not separate module

<div className="space-y-6">
  <div className="text-xs text-slate-500 uppercase tracking-wide">
    My Leads → Outreach Queue
  </div>
  <h1>Outreach Queue</h1>
  <p>Drafts and campaigns for businesses in your repository.</p>
</div>
```

---

## Testing Checklist

### Before Release

- [ ] Navigation renders in correct order: Discover, My Leads, Pipeline, Outreach, Templates, Settings
- [ ] My Leads appears for all user roles (not admin-only)
- [ ] Leads Inbox page redirects to My Leads
- [ ] Lead Library page redirects to My Leads
- [ ] Archive button changes status (toggle between Active/Archived views)
- [ ] Delete shows recovery info in copy
- [ ] "Start outreach" button routes to Outreach with business_id param
- [ ] Dashboard "Next step" buttons route correctly
- [ ] Search still works in My Leads
- [ ] CI status filter still works
- [ ] Bulk actions (archive, delete, export) still work
- [ ] No console errors from navigation changes

### User Journey Test

1. New user lands on Dashboard
2. Clicks "Discover businesses" → Goes to Scraper
3. Creates search, gets results
4. Saves leads → Redirected to My Leads
5. Reviews leads in My Leads (now shows all discovered)
6. Selects lead, clicks "Start outreach"
7. Goes to Outreach Queue with lead pre-selected
8. Reviews draft, approves/rejects
9. Later: Returns to My Leads, filters "Active only"
10. Archives a lead → moves to Archived view, status is now archived
11. Can restore it anytime

---

## Risk Mitigation

### Risk 1: Navigation Changes Confuse Existing Users

**Mitigation:**
- Add one-time info toast: "Navigation updated for clarity. My Leads is now your main workspace."
- Keep old URLs working (Leads Inbox redirects to My Leads)
- No data loss; just reordering

### Risk 2: Free Users Can't Access My Leads

**Mitigation:**
- Remove `adminOnly: true` from nav
- Keep feature gates elsewhere (search credits, email limits)
- Verify access control still works after removing adminOnly

### Risk 3: Outreach Route Breaks

**Mitigation:**
- Outreach page already handles query params
- Pre-selecting business is backwards-compatible
- Test with and without business_id param

### Risk 4: Archive Button Confuses Users

**Mitigation:**
- Tooltip explains: "Changes status to archived; business remains in repository"
- Keep "Archived" tab for viewing archived businesses
- Can't accidentally delete with archive button

---

## Rollback Plan

If Phase 0 needs to be reverted:

1. Restore `DashboardShell.tsx` to previous version (undo nav reordering)
2. Restore `MyLeadsWorkspaceClient.tsx` copy updates
3. Restore `dashboard/leads/page.tsx` (undo redirect)
4. Restore `dashboard/library/page.tsx` (undo redirect)
5. Restore `dashboard/page.tsx` (undo copy + routing)

**No data changes, so rollback is clean and safe.**

---

## Success Criteria

After Phase 0 completes:

✅ New users see clear path: Dashboard → Discover → My Leads → Outreach → Pipeline  
✅ All users (not just admin) can access My Leads  
✅ My Leads is described as "permanent repository"  
✅ Archive is clearly a status change, not deletion  
✅ Outreach flows naturally from My Leads selection  
✅ No mention of "moving" or "transferring" leads between modules  
✅ Zero ambiguity: My Leads is where all businesses live  

---

## Schedule

| Task | Hours | Owner | Status |
|------|-------|-------|--------|
| Task 1: Navigation reordering | 2-3 | Frontend | Pending |
| Task 2: Remove admin-only | 1 | Frontend | Pending |
| Task 3: Update copy | 1 | Frontend | Pending |
| Task 4: Archive UI clarity | 2-3 | Frontend | Pending |
| Task 5: Outreach button routing | 2-3 | Frontend | Pending |
| Task 6: Leads Inbox redirect | 1 | Frontend | Pending |
| Task 7: Lead Library merge | 2-3 | Frontend | Pending |
| Task 8: Dashboard copy | 1 | Frontend | Pending |
| Task 9: Hero buttons | 0.5 | Frontend | Pending |
| Task 10: Outreach context | 1-2 | Frontend | Pending |
| Testing & QA | 2-3 | Frontend + QA | Pending |
| **Total** | **~18-21 hours** | | |

**Estimate:** 1 frontend developer, 1 week (assuming 20-25 hours/week available)

---

## Files Changed Summary

```
✏️ components/dashboard/DashboardShell.tsx
   - Reorder NAV_ITEMS
   - Remove adminOnly from My Leads
   - Update descriptions

✏️ app/dashboard/my-leads/page.tsx
   - Update comments and copy

✏️ app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx
   - Update archive UI copy
   - Update delete confirmation copy
   - Update archived lead recommendation
   - Add Outreach button routing
   - Update component documentation

✏️ app/dashboard/page.tsx
   - Update next best step copy and routing
   - Update hero buttons and copy

✏️ app/dashboard/leads/page.tsx
   - Add redirect to My Leads

✏️ app/dashboard/library/page.tsx
   - Add redirect to My Leads

✏️ app/dashboard/outreach/page.tsx
   - Add breadcrumb context showing My Leads → Outreach flow
   - Handle business_id query param for pre-selection

📄 New Files:
   - PHASE_0_AUDIT.md (completed)
   - ADR_MY_LEADS_REPOSITORY.md (completed)
   - PHASE_0_IMPLEMENTATION_PLAN.md (this file)
```

---

## Approval Gate

**Before starting implementation, confirm:**

- [ ] Audit findings are accurate
- [ ] ADR principle is accepted
- [ ] Implementation scope is appropriate
- [ ] Timeline is feasible
- [ ] Rollback plan is clear
- [ ] Testing strategy is acceptable

**Sign-off:** _____________________  
**Date:** _____________________

