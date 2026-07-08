# Prospecting Phase 1: Implementation Audit & Reuse Strategy

**Status:** PRE-IMPLEMENTATION AUDIT  
**Date:** 2026-07-08  
**Purpose:** Identify what exists, what can be reused, and what must be built

---

## Current Outreach Architecture

### Existing Outreach Queue Page (`/dashboard/outreach/page.tsx`)

**Size:** 1,233 lines  
**Purpose:** Display, filter, review, approve, reject, and send draft messages  
**Current workflow:**
1. Load draft messages from `outreach_queue` table
2. Filter by status (draft/approved/sent/rejected), source, automation step
3. Search by recipient or company
4. Review each draft in a side panel
5. Edit, approve, reject, or send

### Key Components in Current Outreach

#### ReviewPanel (`/components/outreach/ReviewPanel.tsx`)
- Slide-in panel for reviewing individual drafts
- Edit subject and email body
- Toggle between edit and preview tabs
- Buttons: Save, Approve, Reject
- **Reusable:** YES — Can extract for edit/review flows

#### UI Patterns Used
- **Badges:** Status badges (Draft, Approved, Sent, Rejected)
- **Filters:** Select dropdowns for status, source, automation step
- **Toast notifications:** Simple message + auto-dismiss
- **Modal/Panel:** Side panel for reviews
- **Lists:** Paginated list of items with filtering

#### Data Structures
```typescript
type QueueItem = {
  id: string
  lead_id: string | null
  company_name: string | null
  contact_email: string | null
  subject: string | null
  body: string | null
  full_email: string | null
  review_status: 'draft' | 'approved' | 'sent' | 'rejected'
  // ... other fields
}
```

---

## What Exists & Can Be Reused

### ✅ Reusable: UI Components & Patterns

| Component/Pattern | Location | Reusable For | How to Reuse |
|------------------|----------|-------------|------------|
| **Badge system** | `page.tsx` lines 92-207 | Status/goal badges | Extract functions: `statusBadge()`, `contextBadge()`, `sourceBadge()` |
| **Toast notifications** | `page.tsx` lines 209-221 | Brief confirmations | Extract `Toast` component |
| **Select filter** | `page.tsx` lines 223-250 | Filtering UI | Extract `FilterSelect` component |
| **ReviewPanel** | `components/outreach/ReviewPanel.tsx` | Draft review/edit | Reuse as-is for outreach prep |
| **Color scheme** | All files | Consistent design | Use same colors, borders, spacing |
| **Typography scale** | All files | Consistent text | Use same text-sm, text-xs, etc. |

### ✅ Reusable: Design Patterns

| Pattern | Used For | Reusable As |
|---------|----------|------------|
| Lightweight cards/rows | Displaying queue items | Business listing, selection |
| Flat text inputs | Search, filtering | Briefing questions |
| Multi-select state | Selecting items | Selecting businesses |
| Modal/side panel pattern | Reviewing drafts | Campaign brief confirmation |
| Pagination | Large lists | Not needed (Phase 1) |
| Icons (Lucide) | Visual hierarchy | All Prospecting UI |

### ✅ Reusable: Existing Functionality

| Feature | Source | Reuse For | Notes |
|---------|--------|-----------|-------|
| My Leads search API | `/lib/leads` | Repository analysis | Existing search patterns |
| Supabase client setup | Throughout | Session management | Existing auth patterns |
| Toast system | Outreach page | Feedback messages | Proven pattern |
| Type-safe filters | Outreach page | Refinement filters | Same dropdown pattern |

---

## What Must Be Built New

### 🆕 New Components (Phase 1)

#### 1. CommercialBriefing Container
- **Purpose:** Multi-step question flow (3 questions)
- **Features:**
  - State management for Q1, Q2, Q3
  - Progress indication (implicit: question number)
  - Validation before next
- **Reuse:** No (unique to Prospecting)
- **Build time:** 2-3 hours
- **Depends on:** Nothing

#### 2. BriefingQuestion1
- **Purpose:** "What are you offering today?"
- **Features:**
  - Text input (free form)
  - Example chips (reusable badge pattern)
  - Clear, minimal UI
- **Reuse:** Input pattern from existing forms
- **Build time:** 1 hour
- **Complexity:** LOW

#### 3. BriefingQuestion2
- **Purpose:** "Who would benefit most from it?"
- **Features:**
  - Text input (free form)
  - Optional "Not sure?" prompt
  - Expandable AI suggestions (placeholder for Phase 3)
- **Reuse:** Input pattern, expandable pattern
- **Build time:** 1.5 hours
- **Complexity:** LOW

#### 4. BriefingQuestion3
- **Purpose:** "What would you like them to do?"
- **Features:**
  - Button group (6 preset + custom)
  - Icon + label per option
  - Selection state
- **Reuse:** Button pattern (similar to status badges)
- **Build time:** 1.5 hours
- **Complexity:** LOW

#### 5. RepositorySearch (Async)
- **Purpose:** Search My Leads based on intent
- **Features:**
  - Loading state: "Looking through your business library…"
  - Query My Leads with intent-derived criteria
  - Show results count
- **Reuse:** My Leads search API, loading patterns
- **Build time:** 2 hours
- **Complexity:** MEDIUM

#### 6. RepositoryResults
- **Purpose:** Display search results and recommendations
- **Features:**
  - Result summary: "I found X businesses"
  - Confidence/matching display
  - "Discover more" button (if needed)
- **Reuse:** Card pattern, badge system
- **Build time:** 1.5 hours
- **Complexity:** LOW

#### 7. RefinementOptions
- **Purpose:** Optional filtering before selection
- **Features:**
  - 4 filter types: Industry, Location, Size, CI Signals
  - Live count update
  - All optional (skip-able)
- **Reuse:** FilterSelect component, dropdown pattern
- **Build time:** 3-4 hours
- **Complexity:** MEDIUM

#### 8. CapacitySelection
- **Purpose:** "How many businesses would you like to reach?"
- **Features:**
  - Slider or number input
  - Display: "X out of Y"
  - Recommendation text
- **Reuse:** Input pattern
- **Build time:** 1 hour
- **Complexity:** LOW

#### 9. CampaignBrief
- **Purpose:** Confirmation summary before starting
- **Features:**
  - Display all briefing data
  - Single CTA: "Start Preparing Outreach"
  - Back button for refinement
- **Reuse:** Card pattern, badge system
- **Build time:** 1.5 hours
- **Complexity:** LOW

#### 10. AutomationLadder
- **Purpose:** "How would you like to prepare your outreach?"
- **Features:**
  - 3 cards (manual, personalize, generate)
  - Selection state
  - Effort/speed labels
- **Reuse:** Card pattern, badge system
- **Build time:** 1.5 hours
- **Complexity:** LOW

#### 11. ProspectingWorkspace (Container)
- **Purpose:** Orchestrate all steps
- **Features:**
  - State management (currentStep, briefing, businesses, etc.)
  - Navigation (next/back)
  - Session persistence
  - Route to outreach prep
- **Reuse:** No (unique orchestration)
- **Build time:** 2-3 hours
- **Complexity:** MEDIUM

### 🆕 New API Endpoints

#### POST `/api/prospecting/search-my-leads`
**Input:**
```json
{
  "offering": "AI Coaching",
  "audience": "Marketing Agencies",
  "filters": { "industry": ["Technology"], "size": ["Mid-market"] }
}
```

**Output:**
```json
{
  "totalMatches": 84,
  "matchesWithCI": 45,
  "matchesWithoutCI": 39,
  "recommendation": "continue" | "discover_more",
  "businessIds": ["id1", "id2", ...]
}
```

**Implementation:** Query My Leads with intent-derived criteria, count results, provide recommendation

**Reuse:** Existing My Leads query patterns, no new database

---

## Reuse Strategy: Component Extraction

### 1. Extract Existing Components Into Shared Utilities

**From:** `/app/dashboard/outreach/page.tsx`

**Extract to:** `/components/ui/badges.tsx` (or similar)
```typescript
// NEW FILE: components/ui/badge-utils.tsx
export function statusBadge(status: 'draft' | 'approved' | 'sent' | 'rejected') { /* ... */ }
export function contextBadge(status: string) { /* ... */ }
export function sourceBadge(source: string) { /* ... */ }
export function matchBadge(score: number | null) { /* ... */ }
export function stepBadge(step: string | null) { /* ... */ }
export function ctaBadge(label: string | null, type: string | null) { /* ... */ }
```

**Benefit:** Reuse badge logic in Prospecting + future modules

### 2. Extract Filter Component

**From:** `/app/dashboard/outreach/page.tsx` lines 223-250

**Extract to:** `/components/ui/FilterSelect.tsx`
```typescript
// NEW FILE: components/ui/FilterSelect.tsx
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: { /* ... */ }) { /* ... */ }
```

**Benefit:** Use in Prospecting refinement filters, potentially elsewhere

### 3. Extract Toast Component

**From:** `/app/dashboard/outreach/page.tsx` lines 209-221

**Extract to:** `/components/ui/Toast.tsx`
```typescript
// NEW FILE: components/ui/Toast.tsx
export function Toast({ message, onDone }: { /* ... */ }) { /* ... */ }
```

**Benefit:** Reusable feedback system

### 4. Reuse ReviewPanel As-Is

**From:** `/components/outreach/ReviewPanel.tsx`  
**Use:** Import into Prospecting when user moves to outreach preparation (Phase 1.5)  
**No changes needed** — panel is generic enough for any draft review

---

## File Structure Plan

### New Prospecting Workspace Files

```
/app/dashboard/prospecting/
├── page.tsx                    ← Entry point (client component)
└── ProspectingWorkspace.tsx    ← Main container + orchestration

/components/prospecting/
├── CommercialBriefing.tsx      ← Container for 3 questions
├── BriefingQuestion1.tsx       ← Q1: Offering
├── BriefingQuestion2.tsx       ← Q2: Audience
├── BriefingQuestion3.tsx       ← Q3: Goal
├── RepositorySearch.tsx        ← Async search + loading
├── RepositoryResults.tsx       ← Display results
├── RefinementOptions.tsx       ← Optional filtering
├── CapacitySelection.tsx       ← How many to reach?
├── CampaignBrief.tsx          ← Confirmation summary
└── AutomationLadder.tsx        ← Preparation mode selection

/components/ui/
├── badges.tsx                  ← Extracted badge utilities
├── FilterSelect.tsx            ← Extracted filter component
└── Toast.tsx                   ← Extracted toast component
```

### Reused Existing Files (No Changes)

```
/components/outreach/ReviewPanel.tsx    ← Imported when needed (Phase 1.5)
/lib/leads/*                             ← Search API used as-is
/lib/commercial-intelligence/*           ← CI data accessed as-is
```

---

## Implementation Plan: Build Order

### Phase 1 Build Order (Sequential)

**Week 1 Build Sequence:**

**Day 1 Morning (2 hours):**
- Extract and refactor shared UI components
  - Extract badge utilities
  - Extract FilterSelect
  - Extract Toast
  - Create new `components/ui/` directory

**Day 1 Afternoon (3 hours):**
- Build CommercialBriefing container
- Build BriefingQuestion1 (offering)
- Build BriefingQuestion2 (audience)
- Build BriefingQuestion3 (goal)

**Day 2 Morning (3 hours):**
- Build RepositorySearch component (async)
- Build RepositoryResults component
- Create API endpoint: `/api/prospecting/search-my-leads`

**Day 2 Afternoon (3 hours):**
- Build RefinementOptions component
- Integrate with My Leads filtering
- Build CapacitySelection component

**Day 3 Morning (3 hours):**
- Build CampaignBrief component (confirmation)
- Build AutomationLadder component
- Build ProspectingWorkspace container (orchestration)

**Day 3 Afternoon (2 hours):**
- Integration testing: full workflow end-to-end
- Create `/app/dashboard/prospecting/page.tsx` entry point
- Handle routing and state persistence

**Day 4 Morning (2 hours):**
- Bug fixes from testing
- Refinements to copy/UX
- Navigation integration (link from My Leads)

**Total:** ~23 hours → 3 days with one developer

---

## What Will NOT Be Built (Phase 1)

❌ **Draft generation** — Phase 1 only captures the decision; Phase 2 generates drafts  
❌ **Email sending** — Handled by existing Outreach Queue  
❌ **Message templates** — Reuse existing template system  
❌ **AI recommendations** — Placeholder only; Phase 3  
❌ **Database changes** — Uses existing `outreach_queue` and leads tables  
❌ **Discover redesign** — Reuse existing Discover workflow  
❌ **My Leads changes** — Query only, no changes

---

## Risk Assessment: What Could Go Wrong

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| My Leads search API doesn't filter correctly | LOW | Test with various intent combinations |
| Session state lost on reload | MEDIUM | Use sessionStorage + context |
| Component prop typing complex | LOW | Use TypeScript strictly |
| Navigation from/to other modules breaks | LOW | Test routing before deployment |
| UI doesn't feel "commercial assistant" | MEDIUM | Compare against design docs; iterate UX copy |

---

## Commit Strategy: Small, Reviewable PRs

Each component gets its own commit:

```
1. refactor: extract badge utilities and FilterSelect
2. feat(prospecting): add CommercialBriefing container
3. feat(prospecting): add BriefingQuestion1, 2, 3 components
4. feat(prospecting): add RepositorySearch and RepositoryResults
5. feat(prospecting): add RepositorySearch API endpoint
6. feat(prospecting): add RefinementOptions component
7. feat(prospecting): add CapacitySelection component
8. feat(prospecting): add CampaignBrief confirmation
9. feat(prospecting): add AutomationLadder component
10. feat(prospecting): add ProspectingWorkspace orchestration
11. feat: add Prospecting page entry point at /dashboard/prospecting
```

Each commit is small, testable, and reviewable.

---

## Go/No-Go Checklist Before Implementation

- [x] Audit complete
- [x] Reuse strategy defined
- [x] Build order sequenced
- [x] Risk assessment done
- [x] File structure planned
- [x] Component list finalized
- [x] API endpoint designed

**Status: READY FOR IMPLEMENTATION** ✅

---

## Summary

**Reuse Strategy:**
- Extract existing badge, filter, and toast components into shared utilities
- Reuse My Leads search API
- Reuse ReviewPanel when needed (Phase 1.5)
- Reuse ALPA design language and patterns throughout

**Build New:**
- 11 Prospecting-specific components
- 1 API endpoint (search-my-leads)
- ProspectingWorkspace container

**Total Effort:** ~23 hours (3 days)
**Risk Level:** LOW
**Reversibility:** HIGH (no database changes)

---

**Ready to begin implementation Phase 1.**

