# Prospecting Workspace Redesign: Complete Design Package

**Status:** DESIGN COMPLETE (Ready for review and approval)  
**Date:** 2026-07-08  
**Deliverables:** 3 comprehensive design documents + this index

---

## Documents in This Package

### 1. **PROSPECTING_DESIGN_SUMMARY.md** ← START HERE
**For:** Quick overview and decision-making  
**Length:** ~5 minutes read  
**Contains:**
- What changed (Before/After)
- Three questions framework
- The flow (intent → repository search → automation choice)
- What doesn't change (preservation checklist)
- Implementation phases
- Success criteria
- **Decision gate (ready for your approval)**

**Use this to:** Understand the concept and approve or request modifications

---

### 2. **PROSPECTING_WORKSPACE_DESIGN.md** ← DETAILED SPEC
**For:** Understanding all implementation details  
**Length:** ~20 minutes read  
**Contains:**
- Complete three-question framework with UI/UX
- Workflow flow diagrams (intent → repository → discovery → automation)
- Search criteria derivation (how Q2 becomes My Leads search)
- Discovery recommendation logic
- Component specifications (exact UI for each)
- Page structure & component hierarchy
- Data flow: Session state architecture
- Navigation and routing
- Automation ladder outcomes (3 levels)
- Implementation phases (Phase 1, 2, 3)

**Use this to:** Understand all technical details before implementation

---

### 3. **PROSPECTING_ARCHITECTURE_ALIGNMENT.md** ← PROOF OF INTEGRITY
**For:** Verifying that design respects all existing architecture  
**Length:** ~15 minutes read  
**Contains:**
- ADR-001 alignment (My Leads repository principle)
- ADR-002 alignment (database as source of truth)
- ADR-003 alignment (CI immutability and versioning)
- ADR-004 alignment (module responsibility boundaries)
- Data ownership matrix (who owns what)
- Message flow diagram (intent to outreach)
- Why session state is intentionally ephemeral
- Discover integration without modification
- Admin-only preservation
- Zero database schema changes
- Backward compatibility matrix
- Comprehensive checklist

**Use this to:** Confirm that nothing breaks, nothing changes unnecessarily, all principles preserved

---

## Quick Decision Framework

**This design:**

✅ **Preserves everything**
- My Leads unchanged
- Discover unchanged
- Commercial Intelligence unchanged
- Database schema unchanged
- All ADRs remain valid
- Admin-only intact

✅ **Adds only UX flow**
- 6-step question flow
- Session state (ephemeral)
- Intelligent routing
- Component hierarchy

✅ **Enables future growth**
- Phase 1: MVP (basic flow)
- Phase 2: Discover integration
- Phase 3: AI enhancements

✅ **Fixes the user experience**
- Start with intent, not data
- Progressive automation
- Channel-agnostic framing
- Natural workflow

---

## Reading Guide by Role

### If you're a **Product Person**
1. Read: PROSPECTING_DESIGN_SUMMARY.md (core concept)
2. Focus on: "What changed", "The three questions", "Success criteria"
3. Then: Decide — approve or request modifications

### If you're a **Developer** (planning implementation)
1. Read: PROSPECTING_WORKSPACE_DESIGN.md (complete spec)
2. Focus on: "Component Specifications", "Page Structure", "Data Flow"
3. Then: Plan Phase 1 implementation

### If you're an **Architect** (verifying design)
1. Read: PROSPECTING_ARCHITECTURE_ALIGNMENT.md (ADR proofs)
2. Focus on: "ADR alignment", "Data ownership", "No breaking changes"
3. Then: Confirm architectural soundness

### If you're **Reviewing Everything**
1. PROSPECTING_DESIGN_SUMMARY.md (5 min overview)
2. PROSPECTING_ARCHITECTURE_ALIGNMENT.md (10 min verification)
3. PROSPECTING_WORKSPACE_DESIGN.md (20 min details)
4. Total: ~35 minutes for complete understanding

---

## Key Design Decisions (TL;DR)

| Decision | Why | Impact |
|----------|-----|--------|
| Start with intent (Q1-Q3) | Users think about goals, not data | UX starts with user intent |
| Search My Leads (not create) | Respect repository principle | Only query, never own |
| Optional Discover (if needed) | Don't force discovery | Natural flow if needed |
| Three automation levels | Respect user agency | Not forcing AI |
| Session state (ephemeral) | Keep persistence clean | No database changes |
| Channel-agnostic language | Enable future channels | Say "reach", not "email" |
| Phase 1 MVP focused | Get to working version fast | 3-4 days to MVP |

---

## What Gets Built When

### Phase 1 (Week 1): MVP
- ✅ Three question components
- ✅ My Leads search integration
- ✅ Automation ladder selection
- ✅ Route to message creation
- **Result:** Intent-driven workflow works end-to-end

### Phase 2 (Week 2): Discover Integration
- ✅ Detection: "Only X matches"
- ✅ AI-generated search suggestions
- ✅ Navigation to Discover with intent
- ✅ Auto-return with new businesses
- **Result:** Seamless discovery flow

### Phase 3 (Ongoing): AI Enhancements
- ✅ Industry/type recommendations
- ✅ Template personalization
- ✅ Full message generation
- **Result:** Progressive automation

---

## Risk Assessment

**Technical Risks:** ✅ NONE
- All changes are UI/component level
- Database unchanged
- My Leads unchanged
- CI unchanged
- All architecture preserved

**User Experience Risks:** ✅ MINIMAL
- Backward compatible (old flows still work)
- New flows layer on top
- Can always revert if needed
- Fully admin-only (can test with small group)

**Maintenance Risks:** ✅ NONE
- No new data models
- Session state is simple
- Clear separation of concerns
- No circular dependencies

---

## Approval Checklist

Before proceeding to Phase 1, confirm:

**Concept:**
- [ ] Intent-first approach feels right?
- [ ] Three questions are the right ones?
- [ ] Automation ladder (manual → personalize → generate) works?

**Technical:**
- [ ] Session state approach acceptable?
- [ ] My Leads search integration makes sense?
- [ ] Discover integration strategy clear?

**Architecture:**
- [ ] All ADRs preserved?
- [ ] Admin-only preserved?
- [ ] Database unchanged?
- [ ] Backward compatible?

**Implementation:**
- [ ] Phase 1 timeline realistic (3-4 days)?
- [ ] Component hierarchy clear?
- [ ] Ready to proceed?

---

## Questions & Discussion

**Before approval, please address any:**

1. **Concerns about the concept?**
   - Is intent-first the right direction?
   - Should any questions be different?

2. **Concerns about the flow?**
   - Is the automation ladder right?
   - Should Discover integration work differently?

3. **Concerns about the architecture?**
   - Is session state approach acceptable?
   - Are any ADRs at risk?

4. **Concerns about the implementation?**
   - Is Phase 1 scope appropriate?
   - Should phasing be different?

---

## Next Actions

**If approved:**
→ Proceed to Phase 1 implementation (3-4 days)
→ Build six UI components
→ Integrate with My Leads search
→ Test end-to-end flow

**If modifications requested:**
→ Update design documents
→ Get re-approval
→ Proceed to implementation

**If more discussion needed:**
→ Schedule review
→ Discuss specific concerns
→ Revise design as needed

---

## Summary Statement

**The Prospecting workspace redesign shifts ALPA's user experience from data-first ("What do I have?") to intent-first ("What do I want to accomplish?"). This requires zero architectural changes, preserves all existing modules and data models, and enables progressive automation without forcing AI. Phase 1 MVP can be delivered in 3-4 days.**

---

**Design package complete. Ready for your review and approval.**

