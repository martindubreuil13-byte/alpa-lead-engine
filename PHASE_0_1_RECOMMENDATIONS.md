# Phase 0.1 Recommendations: Minimal Clarity Improvements

**Goal:** Improve architectural clarity with minimal changes. No new functionality. No database migrations. Admin-only features preserved.

**Timeline:** 3-5 days  
**Risk Level:** VERY LOW (UI/copy only)  
**Reversibility:** Fully reversible (no data changes)

---

## Decision Gate

**Before implementing Phase 0.1, confirm:**

- [ ] ADR system is approved (4 foundational ADRs establish architecture)
- [ ] Code audit findings are accurate
- [ ] Phase 0.1 scope is appropriately minimal
- [ ] No "nice-to-haves" added (stay focused on clarity, not features)

---

## Phase 0.1 Scope

**What Phase 0.1 addresses:**
- UI terminology (consistent language about businesses)
- Navigation clarity (remove duplicate modules from nav)
- Module responsibility (prevent certain actions in wrong places)
- Copy/language (remove "movement" framing)
- Button routing (connect "Start outreach" to correct destination)

**What Phase 0.1 does NOT address:**
- Database schema changes
- Business logic changes
- New entities or data models
- Outreach/Pipeline functionality
- Status field storage (still exists, just clearer semantics)

---

## Recommendation 1: Consolidate Duplicate Module Views (HIGH PRIORITY)

**Issue:** Leads Inbox and Lead Library create confusion about where business data lives.

**Recommendation:**

Remove from navigation:
- ❌ Leads Inbox (`/dashboard/leads`) — superseded by My Leads
- ❌ Lead Library (`/dashboard/library`) — search features absorbed into My Leads

Keep:
- ✅ My Leads (`/dashboard/my-leads`) — single, authoritative business view

**Implementation:**

1. Update `components/dashboard/DashboardShell.tsx`:
   - Remove Leads Inbox from NAV_ITEMS
   - Remove Lead Library from NAV_ITEMS
   - Keep My Leads (remain admin-only per user's adjustment)

2. Redirect old pages:
   - `/dashboard/leads` → `/dashboard/my-leads` with toast: "Leads Inbox has been consolidated into My Leads"
   - `/dashboard/library` → `/dashboard/my-leads` with toast: "Search your businesses in My Leads"

3. Update links in codebase:
   - Dashboard "View leads" button → `/dashboard/my-leads` (not `/dashboard/leads`)
   - Any other links to Leads Inbox/Library → My Leads

**Benefits:**
- ✅ Single source of truth is obvious
- ✅ User knows exactly where to find businesses
- ✅ Reduced navigation cognitive load
- ✅ Aligns with [[ADR-001]]

**Risk Level:** VERY LOW
- No data changes
- Old URLs still work (redirect)
- Admin-only users already use My Leads

---

## Recommendation 2: Rename `moveToPipeline()` and Update Copy (HIGH PRIORITY)

**Issue:** Function name and button copy suggest leads "move" to Pipeline, contradicting [[ADR-001]].

**Recommendation:**

Change semantics from "move" to "stage assignment":

1. **Rename function** in `app/dashboard/leads/LeadsPageClient.tsx`:
   ```typescript
   // BEFORE
   async function moveToPipeline(ids: string[]) {
     // ...
     .update({ status: 'pipeline' })
   }
   
   // AFTER
   async function updatePipelineAssignment(ids: string[]) {
     // ...
     .update({ pipeline_stage: 'discovered' })  // or appropriate default
   }
   ```

2. **Update UI button copy**:
   ```typescript
   // BEFORE
   <button onClick={() => moveToPipeline(selected)}>
     Move to Pipeline
   </button>
   
   // AFTER
   <button onClick={() => updatePipelineAssignment(selected)}>
     Add to Pipeline
   </button>
   ```

3. **Update tooltip/help text**:
   ```
   BEFORE: "Move this lead to the pipeline for tracking"
   AFTER: "Assign this business to pipeline tracking"
   ```

**Database Impact:** NONE
- Still updates the same field
- Semantics change, not storage change
- No migration needed

**Benefits:**
- ✅ Clearer mental model (assignment, not movement)
- ✅ Aligns with [[ADR-001]]: businesses stay in repository
- ✅ Aligns with [[ADR-004]]: Pipeline module just tracks status

**Risk Level:** VERY LOW
- Function name change (internal refactor)
- Button text change (UX improvement)
- No logic change
- Fully reversible

---

## Recommendation 3: Fix "Start Outreach" Button (HIGH PRIORITY)

**Issue:** My Leads button says "Start outreach" but doesn't route anywhere.

**Recommendation:**

Route button to Outreach Queue with business pre-selected:

1. **Update button** in `app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx:1237`:
   ```typescript
   // BEFORE
   <button
     onClick={(e) => e.stopPropagation()}
     className="flex-1 px-3 py-2 ..."
   >
     Start outreach
   </button>
   
   // AFTER
   <button
     onClick={(e) => {
       e.stopPropagation()
       router.push(`/dashboard/outreach?business_id=${lead.id}`)
     }}
     className="flex-1 px-3 py-2 ..."
   >
     Start outreach
   </button>
   ```

2. **Update Outreach Queue** to accept and pre-select business:
   - Parse `business_id` query param
   - Pre-select in campaign creation form
   - Show business details prominently

3. **Add breadcrumb** to Outreach Queue:
   ```
   My Leads > Select Business > Create Campaign
   ```

**Benefits:**
- ✅ Clear action path: My Leads → Outreach
- ✅ Aligns with [[ADR-004]]: Outreach references businesses from My Leads
- ✅ User knows next step after reviewing business

**Risk Level:** VERY LOW
- Button is currently non-functional
- Only improves routing
- Outreach Queue already handles business selection
- Pre-selection is additive, not breaking

---

## Recommendation 4: Standardize Terminology (MEDIUM PRIORITY)

**Issue:** Codebase mixes "lead" and "business" terminology inconsistently.

**Recommendation:**

Establish clear terminology:
- **Internal/Architecture:** Use "business" consistently
- **User-Facing:** Use "business" or "prospect" depending on context
- **Never mix** both in same context

**Implementation:**

1. **Immediate (High-value refactors):**
   - Rename functions in Scraper: `formatLeadDiscoveryLine()` → `formatBusinessDiscoveryLine()`
   - Rename variables in My Leads: `archivedLeadIds` → `archivedBusinessIds`
   - Update comments referencing "lead" → "business"

2. **Deferred (Nice-to-have, Phase 2+):**
   - Rename types: `MyLeadsLead` → `MyLeadsBusiness`
   - Rename all internal "lead" variables to "business"

3. **Copy Updates (Immediate):**
   - Dashboard: "Start by discovering your first businesses" (not "prospects")
   - Scraper: "Businesses found", "Contact information extracted" (consistent)
   - My Leads: "Business repository", "All your businesses" (in descriptions)

**Benefits:**
- ✅ Clearer mental model (everyone talking about same thing)
- ✅ Aligns with [[ADR-001]]: Business is the permanent entity
- ✅ Easier for new developers to understand

**Risk Level:** LOW
- Refactoring function names and variables
- No logic changes
- Requires careful testing (but low behavioral risk)

**Recommendation:** Do selective high-value renames in Phase 0.1; full refactor in Phase 1 if needed.

---

## Recommendation 5: Remove Scraper's Pipeline Status Assignment (HIGH PRIORITY)

**Issue:** Scraper sets `status: 'pipeline'`, violating [[ADR-004]].

**Recommendation:**

Remove Scraper's ability to set business status. Only allow creation:

1. **Remove from `app/dashboard/scraper/page.tsx`:**
   ```typescript
   // REMOVE THIS
   await supabase
     .from('leads')
     .update({ status: 'pipeline' })  // ← DELETE
     .eq('id', id)
   
   // KEEP: Lead creation (which sets default status)
   ```

2. **Remove UI hint:**
   ```typescript
   // REMOVE THIS
   inPipeline={lead.status === 'pipeline'}
   
   // REPLACE WITH (if needed)
   // Just show business exists; let Pipeline module handle stages
   ```

3. **Update Scraper copy** to clarify what it does:
   - "Start Discovery" → "Find businesses"
   - "Move to Pipeline" button → Remove (businesses automatically in My Leads)
   - Clear: "Discovered businesses appear in My Leads"

**Database Impact:** NONE
- Businesses still created
- Status still stored
- Just stops Scraper from updating status
- Users manage Pipeline through Pipeline module, not Scraper

**Benefits:**
- ✅ Single responsibility: Scraper only discovers, doesn't manage
- ✅ Aligns with [[ADR-004]]: Discover module acquires; doesn't manage
- ✅ Clearer data flow

**Risk Level:** LOW
- Removes a feature (moving businesses from Scraper to Pipeline)
- Users instead manage via My Leads → Add to Pipeline
- Minimal disruption (admin-only, can document change)

---

## Recommendation 6: Update Navigation Order (MEDIUM PRIORITY)

**Issue:** Navigation order doesn't match user journey.

**Recommendation:**

Reorder navigation to show user journey:

```
BEFORE:
- Dashboard
- My Leads [admin-only, accent]
- Leads Inbox [REMOVE per Rec #1]
- Discover (Scraper)
- Lead Library [REMOVE per Rec #1]
- Pipeline
- Outreach Queue
- Templates
- Settings

AFTER:
- Dashboard
- Discover (Scraper) [moved up]
- My Leads [admin-only, accent] ← primary workspace
- Pipeline
- Outreach Queue
- Templates
- Settings
```

**Implementation:**
- Update NAV_ITEMS array order in `components/dashboard/DashboardShell.tsx`
- Update descriptions to clarify user journey

**Benefits:**
- ✅ Matches user journey: Discover → My Leads → Outreach → Pipeline
- ✅ My Leads prominence makes it obvious it's the workspace
- ✅ Clear progression from acquisition to execution

**Risk Level:** VERY LOW
- Pure UI reordering
- No logic changes
- Fully reversible

---

## Recommendation 7: Update Comments and Docstrings (LOW PRIORITY)

**Issue:** Comments contradict [[ADR-001]] model.

**Recommendation:**

Update comments that suggest "movement" or "flow" of leads:

1. **Remove from `app/dashboard/my-leads/page.tsx`:**
   ```typescript
   // BEFORE
   // Matches Lead Library exactly to ensure consistent totals across ALPA
   
   // AFTER
   // My Leads Repository: The permanent, authoritative view of all businesses
   ```

2. **Remove from `app/dashboard/leads/LeadsPageClient.tsx`:**
   ```typescript
   // BEFORE
   // This is the Inbox; leads come here after discovery
   
   // AFTER
   // [DELETE THIS ENTIRE COMMENT]
   // Or: // [DEPRECATED] Consolidate into My Leads
   ```

3. **Add to violated locations:**
   ```typescript
   // ADR-001: Businesses never "move" between modules.
   // Status changes, but businesses remain in the repository.
   ```

**Benefits:**
- ✅ Prevents future confusion
- ✅ Documents architectural principles in code
- ✅ Helps new developers understand design intent

**Risk Level:** NONE
- Comments only, no code changes

---

## Phase 0.1 Implementation Checklist

### Tier 1: Must Do (Critical for Clarity)
- [ ] Remove Leads Inbox from nav and redirect
- [ ] Remove Lead Library from nav and redirect
- [ ] Fix "Start outreach" button routing
- [ ] Rename `moveToPipeline()` function and update copy
- [ ] Remove Scraper's pipeline status assignment

### Tier 2: Should Do (High-Value)
- [ ] Update navigation order
- [ ] Standardize terminology (selective renames)
- [ ] Update comments for clarity

### Tier 3: Nice-to-Have (Polish)
- [ ] Update Dashboard copy to reflect new nav
- [ ] Add breadcrumb to Outreach showing My Leads → Outreach flow
- [ ] Update Scraper copy to clarify discovery-only role

---

## Success Metrics for Phase 0.1

After implementation, verify:

✅ Users don't see Leads Inbox or Lead Library in navigation  
✅ My Leads is positioned as the central workspace  
✅ "Start outreach" button routes to Outreach Queue  
✅ Scraper no longer sets business status to 'pipeline'  
✅ Navigation order shows journey: Discover → My Leads → Pipeline → Outreach  
✅ Comments reference [[ADR-001]] and module principles  
✅ Terminology is consistent (no "lead" vs "business" mixing)  
✅ No broken links or orphaned buttons  

---

## Testing Strategy

**Regression Testing:**
- [ ] Discover still creates businesses
- [ ] Businesses still appear in My Leads
- [ ] My Leads filtering works
- [ ] Pipeline stage transitions work
- [ ] Outreach Queue still functions
- [ ] Admin-only restrictions still respected

**User Journey Testing:**
1. Start: Dashboard
2. Click "Discover" → Scraper loads, search works
3. Import businesses → Appear in My Leads
4. Review business in My Leads → All info visible
5. Click "Start outreach" → Routing to Outreach Queue works
6. Click "Add to Pipeline" → Business appears in Pipeline

---

## Timeline & Effort

| Task | Hours | Complexity |
|------|-------|-----------|
| Remove Leads Inbox/Library | 1 | Low |
| Fix Start Outreach routing | 1.5 | Low |
| Rename moveToPipeline + update copy | 1.5 | Low |
| Remove Scraper pipeline assignment | 1 | Low |
| Reorder navigation | 0.5 | Low |
| Terminology standardization | 2-3 | Medium |
| Update comments | 1 | Low |
| Testing & QA | 2-3 | Low |
| **TOTAL** | **~10-12 hours** | **LOW** |

**Estimate:** 1 developer, 1-2 days of focused work

---

## Rollback Plan

If Phase 0.1 needs to be reverted:
1. Restore navigation to original order
2. Restore Leads Inbox and Lead Library to nav
3. Restore `moveToPipeline()` function names
4. Restore Scraper pipeline assignment code
5. Restore original comments

**No data changes, so rollback is clean and safe.**

---

## What Changes in Codebase

### Files Modified (8 files)
```
✏️ components/dashboard/DashboardShell.tsx
   - Remove Leads Inbox from NAV_ITEMS
   - Remove Lead Library from NAV_ITEMS
   - Reorder nav items

✏️ app/dashboard/leads/page.tsx
   - Add redirect to My Leads

✏️ app/dashboard/library/page.tsx
   - Add redirect to My Leads

✏️ app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx
   - Fix "Start outreach" button routing
   - Update comments
   - Rename variables (selective)

✏️ app/dashboard/scraper/page.tsx
   - Remove status: 'pipeline' assignment
   - Rename formatLeadDiscoveryLine → formatBusinessDiscoveryLine
   - Remove inPipeline UI hints
   - Update copy

✏️ app/dashboard/leads/LeadsPageClient.tsx
   - Rename moveToPipeline → updatePipelineAssignment
   - Update button copy
   - Update comments

✏️ app/dashboard/page.tsx
   - Update Dashboard copy
   - Update link destinations

✏️ docs/architecture/adr/ADR-004-module-responsibility-principle.md
   - Add note that Phase 0.1 implements these principles
```

---

## Approval Gate

**Before starting Phase 0.1, confirm:**

- [ ] Audit findings are accurate
- [ ] Recommendations are appropriately minimal
- [ ] No features are being added (only clarity improvements)
- [ ] Admin-only restrictions remain
- [ ] No database migrations are needed
- [ ] Timeline is realistic (1-2 days)

**Who can approve:** Product Architecture (Martin Dubreuil)

---

## Next Steps After Phase 0.1

1. **Measure:** Did navigation clarity improve? Are users less confused?
2. **Phase 1:** Implement versioned CI results table (separate concern)
3. **Phase 2:** Add Conversation entity + Message model
4. **Phase 3:** Full database schema alignment with [[ADR-001]]-[[ADR-004]]

---

**Recommendations completed:** 2026-07-07  
**Status:** Ready for review and approval

