# Prospecting Phase 1: Final Implementation Strategy (REVISED)

**Status:** READY FOR APPROVAL  
**Date:** 2026-07-08  
**Revision:** Incorporates architectural corrections (no new directories, no new APIs, simplified components)

---

## Executive Summary

**What's Being Built:**  
A commercial briefing workflow that runs BEFORE the Outreach Queue. User answers 3 questions → searches My Leads → refines → selects capacity → sees campaign confirmation → then moves to outreach preparation.

**Where It Lives:**  
Evolved `/app/dashboard/outreach/page.tsx` (no new directory)

**What It Uses:**  
Existing My Leads search APIs (no new `/api/prospecting/*` endpoints)

**Component Count:**  
7 new components (not 11) for Phase 1

**Effort:**  
~18-20 hours (3 days) for Phase 1 MVP

---

## Part 1: Audit of Existing Outreach Page (1,233 lines)

### Current Purpose
The Outreach Queue page manages the **draft review & approval workflow**:
- Loads existing drafts from `outreach_queue` table
- Filters by status, source, automation step, template
- Reviews each draft in a side panel (ReviewPanel component)
- Edits, approves, rejects, sends, or deletes drafts

### What Can Be Preserved As-Is
| Code Section | Lines | Purpose | Reuse Decision |
|--------------|-------|---------|-----------------|
| Badge system | 92-207 | Status/context/source/step/cta/match badges | **EXTRACT** to shared utility |
| Toast system | 209-221 | Show temporary notifications | **EXTRACT** to shared component |
| FilterSelect component | 223-250 | Dropdown filter UI | **EXTRACT** to shared component |
| fetchQueue() | 304-343 | Load paginated drafts | **PRESERVE** (no changes) |
| fetchFilterMetadata() | 345-386 | Load templates & sender settings | **PRESERVE** (no changes) |
| applyQueueFilters() | 388-416 | Filter drafts by status/source | **PRESERVE** (no changes) |
| fetchQueueStats() | 418-468 | Count drafts by status | **PRESERVE** (no changes) |
| Queue render section | 811-1233 | Display filtered drafts, cards, pagination | **PRESERVE** (no changes) |
| ReviewPanel integration | Embedded | Side panel for draft review/edit | **PRESERVE** (no changes) |
| Bulk actions | 954-997 | Approve/send/delete selected | **PRESERVE** (no changes) |

### What Changes
| Component | Change | Why |
|-----------|--------|-----|
| page.tsx structure | Add conditional routing logic | Show Prospecting flow OR Queue view based on state |
| Initial render | Add "Start new campaign" flow | Before showing queue, show briefing if user is starting |

---

## Part 2: Component Architecture (Simplified)

### New Components Required (7 total)

```
/components/outreach/
├── ProspectingSession.tsx          ← Main container (orchestration)
├── CommercialBriefing.tsx          ← Three-question flow
├── RepositorySearch.tsx            ← Async search of My Leads
├── RepositoryResults.tsx           ← Display search results
├── RefinementOptions.tsx           ← Optional filters
├── CapacitySelection.tsx           ← "How many to reach?"
├── CampaignBrief.tsx               ← Confirmation summary
└── AutomationLadder.tsx            ← Preparation mode selection

/components/ui/
├── badge-utils.tsx                 ← EXTRACT: badge functions
├── FilterSelect.tsx                ← EXTRACT: filter dropdown
└── Toast.tsx                       ← EXTRACT: toast notifications
```

### Component Responsibilities (Not Over-Decomposed)

#### 1. ProspectingSession (Container)
**Purpose:** Orchestrate the full briefing → search → refinement → selection → confirmation workflow  
**Responsibility:**
- State management (currentStep, briefing answers, search results, filters, capacity, automationLevel)
- Step navigation (next/back)
- Session persistence (sessionStorage)
- Conditional rendering of current step

**Estimated time:** 2-3 hours  
**Dependencies:** All components below

#### 2. CommercialBriefing (No Sub-Components in Phase 1)
**Purpose:** Ask 3 questions with minimal UI  
**Contains inline:**
- Q1: "What are you offering today?" (text input)
- Q2: "Who would benefit most from it?" (text input)
- Q3: "If someone receives your message, what would you like them to do?" (button group)

**Note:** Start inline. If each question becomes complex (expandable AI suggestions, etc), extract to BriefingQuestion1/2/3 in Phase 2+

**Estimated time:** 2 hours  
**State passed:** (offering, audience, goal) → parent  
**State received:** Current answers from parent

#### 3. RepositorySearch (Simple Async)
**Purpose:** Query My Leads based on commercial intent, show loading state  
**Responsibility:**
- Accept: offering, audience, goal
- Query: My Leads using existing search patterns (reuse `/lib/leads` query logic)
- Show loading state: "Looking through your business library…"
- Return: { totalMatches, matchesWithCI, matchesWithoutCI }

**Estimated time:** 1.5 hours  
**API call:** Reuse existing My Leads search query (no new endpoint)
**Note:** This is a simple query wrapper, not a new API endpoint

#### 4. RepositoryResults (Display Only)
**Purpose:** Show search results with assistant tone  
**Display:**
- Success: "I found 84 businesses matching your objective."
- Insufficient: "I only found 11 businesses. I recommend discovering more."
- Continue button (if > threshold)

**Estimated time:** 1 hour  
**No filtering logic** (filters come next)

#### 5. RefinementOptions (Optional Filters)
**Purpose:** Let user optionally refine search results before committing  
**Filters:**
- Industry (multi-select or tag pills)
- Location (multi-select)
- Company Size (buttons: Startup, Mid-market, Enterprise)
- CI Signals (checkbox group)

**Features:**
- All filters optional (user can skip)
- Live count update as filters change
- Apply button to confirm

**Estimated time:** 2.5 hours  
**Data source:** Existing My Leads schema (no new fields needed)

#### 6. CapacitySelection (Simple Input)
**Purpose:** "How many would you like to reach today?"  
**Features:**
- Slider or number input
- Display: "You're selecting X out of Y"
- Recommended range shown
- Min 1, Max ≤ total filtered count

**Estimated time:** 1 hour

#### 7. CampaignBrief (Confirmation Card)
**Purpose:** Show full campaign summary before starting prep  
**Display:**
- Offering: {value from Q1}
- Audience: {value from Q2}
- Goal: {value from Q3}
- Matching Businesses: {total count}
- Selected: {user choice}
- Preparation Mode: {automation level chosen}

**Buttons:**
- "Start Preparing Outreach" (primary)
- "Go back to refine" (secondary)

**Estimated time:** 1 hour

#### 8. AutomationLadder (Selection Only)
**Purpose:** User chooses preparation mode  
**Options:**
1. "I'll prepare everything myself" (manual mode)
2. "AI helps me personalize" (personalization mode)
3. "AI prepares everything for review" (generation mode)

**Features:**
- Show effort/speed tradeoff per option
- Selection state
- Selected option persists to CampaignBrief

**Estimated time:** 1 hour

---

## Part 3: API Reuse Strategy (No New Endpoints)

### Existing APIs to Reuse

#### 1. My Leads Search
**Endpoint:** `/api/leads/search` OR direct Supabase query in component  
**How Used:** RepositorySearch component queries My Leads with intent-derived criteria  
**Example:**
```typescript
// In RepositorySearch component:
const query = supabase
  .from('leads')
  .select('*', { count: 'exact' })
  .eq('user_id', user.id)
  // Apply intent-derived filters (industry contains "X", etc.)
  .ilike('industry', `%${parsedIndustry}%`)
```

**No new endpoint required.** Reuse existing pattern.

#### 2. Commercial Intelligence
**Source:** Existing `commercial_intelligence` table  
**How Used:** RefinementOptions filters by CI signals, RepositorySearch ranks by CI relevance  
**Change:** None (read-only consumption)

#### 3. Templates & Sender Settings
**Existing:** Already loaded by current Outreach page  
**No changes needed** (will be available from page context)

---

## Part 4: File Modifications

### Files to Create (New)

| File | Type | Purpose | Scope |
|------|------|---------|-------|
| `components/outreach/ProspectingSession.tsx` | Component | Orchestration container | ~250 lines |
| `components/outreach/CommercialBriefing.tsx` | Component | 3-question flow | ~200 lines |
| `components/outreach/RepositorySearch.tsx` | Component | Async My Leads search | ~150 lines |
| `components/outreach/RepositoryResults.tsx` | Component | Display results | ~100 lines |
| `components/outreach/RefinementOptions.tsx` | Component | Optional filters | ~250 lines |
| `components/outreach/CapacitySelection.tsx` | Component | How many to reach | ~120 lines |
| `components/outreach/CampaignBrief.tsx` | Component | Confirmation summary | ~150 lines |
| `components/outreach/AutomationLadder.tsx` | Component | Prep mode selection | ~180 lines |
| `components/ui/badge-utils.tsx` | Utility | Extracted badge functions | ~180 lines |
| `components/ui/FilterSelect.tsx` | Component | Extracted filter dropdown | ~80 lines |
| `components/ui/Toast.tsx` | Component | Extracted toast | ~60 lines |

**Total new lines:** ~1,700 lines (spread across 11 files)

### Files to Modify (Existing)

| File | Changes | Scope |
|------|---------|-------|
| `app/dashboard/outreach/page.tsx` | Add conditional: if new campaign → show ProspectingSession, else show queue | ~40 lines added |
| `components/outreach/ReviewPanel.tsx` | No changes (reuse as-is) | — |

### Extraction Order (Refactoring)

**Step 1:** Extract shared utilities from current Outreach page
```
FROM: app/dashboard/outreach/page.tsx (lines 92-250)
TO:   components/ui/badge-utils.tsx
      components/ui/FilterSelect.tsx
      components/ui/Toast.tsx
```

**Step 2:** Update current Outreach page to import extracted components
```
import { statusBadge, matchBadge, ... } from '@/components/ui/badge-utils'
import { FilterSelect } from '@/components/ui/FilterSelect'
// ... rest of page works same
```

**Result:** Current Outreach page still works exactly as before, just cleaner

---

## Part 5: Data Flow & State Management

### Session State Shape
```typescript
type ProspectingSession = {
  // Step tracking
  currentStep: 'briefing' | 'searching' | 'results' | 'refinement' | 'capacity' | 'brief' | 'automation'
  
  // Briefing answers
  briefing: {
    offering: string
    audience: string
    goal: string
  }
  
  // Search results
  repository: {
    totalMatches: number
    matchesWithCI: number
    matchesWithoutCI: number
  }
  
  // Active filters
  filters: {
    industry?: string[]
    location?: string[]
    size?: string[]
    ciSignals?: string[]
  }
  filteredCount: number
  
  // User selections
  capacity: number
  automationLevel: 'manual' | 'personalize' | 'generate'
  
  // Ready for handoff
  businesses: string[] // IDs selected
}
```

### Persistence
- Store in `sessionStorage` during workflow
- Clear after "Start Preparing Outreach" or "Cancel"
- Survives page refresh during workflow

---

## Part 6: Page Entry Point Logic

### `/app/dashboard/outreach/page.tsx` - Updated Structure

```typescript
export default function OutreachPage() {
  const [user] = useAuthUser() // existing
  const [campaignStarting, setCampaignStarting] = useState(false)
  
  // Check: Is user starting a new campaign?
  // OR: Are they viewing existing queue?
  
  if (campaignStarting) {
    return <ProspectingSession onComplete={() => setCampaignStarting(false)} />
  }
  
  // Otherwise show existing queue (all current code)
  return <OutreachQueueView /> // existing implementation
}
```

**Why this approach:**
- Same route (`/dashboard/outreach`)
- No new directory
- User experience: "Start new campaign" button shows Prospecting workflow
- After campaign is created: Queue view shows existing drafts
- Evolutionary, not revolutionary

---

## Part 7: Build Sequence (Phase 1)

### Day 1 (7-8 hours)
1. **Extract utilities** (2 hours)
   - badge-utils.tsx
   - FilterSelect.tsx
   - Toast.tsx
   - Update current Outreach page imports

2. **Build CommercialBriefing** (2 hours)
   - 3-question flow inline
   - Validation
   - Navigation

3. **Build RepositorySearch** (1.5 hours)
   - Query My Leads
   - Loading state
   - Error handling

4. **Build RepositoryResults** (1 hour)
   - Display results
   - Success/insufficient states

### Day 2 (7-8 hours)
1. **Build RefinementOptions** (2.5 hours)
   - Industry, Location, Size, CI Signals filters
   - Live count update
   - Apply button

2. **Build CapacitySelection** (1 hour)
   - Slider or number input
   - Bounds

3. **Build CampaignBrief** (1 hour)
   - Summary display
   - Buttons

4. **Build AutomationLadder** (1 hour)
   - 3 option cards
   - Selection state

5. **Build ProspectingSession** (2 hours)
   - Orchestration
   - State management
   - Navigation
   - Session persistence

### Day 3 (3-4 hours)
1. **Integrate with page.tsx** (1 hour)
   - Add conditional routing
   - "Start new campaign" trigger

2. **End-to-end testing** (2-3 hours)
   - Full workflow from Q1 → CampaignBrief
   - Session persistence
   - Error cases
   - Integration with My Leads

**Total:** ~18-20 hours (realistic 3 days with one developer)

---

## Part 8: What's NOT Being Built in Phase 1

❌ Draft generation (AI writes messages) — Phase 2+  
❌ Message templates — Use existing template system if needed  
❌ Discover integration — Phase 2  
❌ Database migrations — Uses existing schema only  
❌ New API endpoints — Reuses existing My Leads queries  
❌ New directory structure — Evolves existing Outreach module

---

## Part 9: Architectural Guarantees

### ✅ All 4 ADRs Preserved
- **ADR-001:** My Leads is repository (Prospecting queries, never owns)
- **ADR-002:** Database authoritative (session state ephemeral)
- **ADR-003:** CI immutable (read-only consumption)
- **ADR-004:** Module boundaries (Prospecting orchestrates, doesn't own)

### ✅ Zero Database Changes
- No new tables
- No new columns
- No migrations
- Uses existing `leads`, `commercial_intelligence`, `outreach_queue` schema

### ✅ Admin-Only Preserved
- Same access control as existing Outreach Queue
- No permission changes
- No public exposure

### ✅ Backward Compatible
- Existing Outreach Queue workflow unchanged
- Existing My Leads unchanged
- Existing Discover unchanged
- Existing CI unchanged

---

## Part 10: Files to Review & Approve

### Components to Reuse
```
✅ /components/outreach/ReviewPanel.tsx
   How: Import into ProspectingSession when user moves to prep phase
   Why: Panel is generic enough for any draft review
```

### Utilities to Extract
```
✅ /components/ui/badge-utils.tsx (from page.tsx lines 92-207)
✅ /components/ui/FilterSelect.tsx (from page.tsx lines 223-250)
✅ /components/ui/Toast.tsx (from page.tsx lines 209-221)
```

### New Components to Build
```
✅ /components/outreach/ProspectingSession.tsx
✅ /components/outreach/CommercialBriefing.tsx
✅ /components/outreach/RepositorySearch.tsx
✅ /components/outreach/RepositoryResults.tsx
✅ /components/outreach/RefinementOptions.tsx
✅ /components/outreach/CapacitySelection.tsx
✅ /components/outreach/CampaignBrief.tsx
✅ /components/outreach/AutomationLadder.tsx
```

### Files to Modify
```
✅ app/dashboard/outreach/page.tsx (add conditional logic, ~40 lines)
✅ Import extracted utilities in existing Outreach page
```

---

## Part 11: Success Criteria

**Phase 1 Complete When:**
- [ ] User can answer 3 briefing questions
- [ ] My Leads search returns results based on intent
- [ ] User can optionally refine with filters
- [ ] User can select capacity (1 to N businesses)
- [ ] Campaign Brief shows accurate summary
- [ ] Session persists across page reloads
- [ ] Entire flow takes < 5 minutes for typical use
- [ ] All code follows existing ALPA patterns
- [ ] No breaking changes to existing workflows
- [ ] Admin-only access enforced

**Performance Targets:**
- Search returns results within 2 seconds
- Page loads under 3 seconds
- Session storage works reliably

**Code Quality:**
- TypeScript strict mode
- All components tested independently
- E2E workflow tested
- No console errors

---

## Summary

**What's Being Built:**
- 7 new Prospecting components (minimal, focused, high-level)
- 3 extracted utility components (reusable)
- 1 modified page (adds conditional routing)

**Where It Lives:**
- Same route: `/dashboard/outreach`
- Same module: `components/outreach/`
- No new directory

**What It Uses:**
- Existing My Leads search APIs
- Existing Commercial Intelligence
- Existing admin-only access control
- Existing ALPA design language

**Effort:**
- 7-8 components to build
- 3 utilities to extract
- 1 page to modify
- ~18-20 hours (3 days)

**Architectural Impact:**
- ✅ Zero breaking changes
- ✅ All 4 ADRs preserved
- ✅ Zero database migrations
- ✅ Backward compatible
- ✅ Admin-only maintained

---

## Ready for Approval

**Before proceeding with implementation, confirm:**

- [ ] Component architecture is clear (7 components, not 11)?
- [ ] No new directory (/app/dashboard/prospecting) — evolve Outreach in-place?
- [ ] No new API (/api/prospecting/search-my-leads) — reuse My Leads queries?
- [ ] File structure makes sense?
- [ ] Build sequence is realistic?
- [ ] All ADRs verified as preserved?
- [ ] Ready to begin Day 1?

**If approved:** Implementation can begin immediately. Expect Phase 1 MVP in 3 calendar days.

**If revisions needed:** Update this document and resubmit for approval.

---

**This strategy prioritizes implementation velocity while preserving all architectural constraints and avoiding unnecessary complexity.**
