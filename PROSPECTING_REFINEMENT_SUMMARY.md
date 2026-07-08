# UX Refinement Summary: What Changed & Why

**Status:** REFINEMENT COMPLETE  
**Date:** 2026-07-08  
**Type:** UX/Language/Flow refinement (zero architectural changes)

---

## Changes at a Glance

| Element | Before | After | Impact |
|---------|--------|-------|--------|
| Entry framing | "Intent Questions" wizard | "Commercial Briefing" | Feels like assistant, not form |
| Q1 | "What are you selling?" | "What are you offering today?" | Value-based, less transactional |
| Q2 | "Who are you targeting?" | "Who would benefit most?" | Customer-first thinking |
| Q3 | Same (good) | Same + label as "Campaign Goal" | Consistent terminology |
| Repository search | "Searching repository…" | "Looking through your business library…" | Human language, assistant tone |
| Results display | Technical count | Natural language ("I found X") | Feels conversational |
| After results | Jump to "how many?" | NEW: Optional filtering | User agency, no paralysis |
| Refinement step | N/A | NEW: Industry/Location/Size/CI filters | Leverage existing data |
| Capacity question | "How many would you like to reach?" | Same + show count vs. total | Clearer context |
| Automation | "Message generation" | "Outreach Preparation" | Channel-agnostic |
| Automation ladder | "Create messages" | "Prepare your outreach" | Progressive, human language |
| Confirmation | Jump straight to prep | NEW: Campaign Brief | Transparency before action |
| Primary CTA | Context-dependent | "Start Preparing Outreach" | Single, clear action |

---

## Five Key Refinements

### Refinement 1: Commercial Briefing (Not a Wizard)
**Change:** Rename "Intent Questions" to "Commercial Briefing"

**Why it matters:**
- Wizard implies filling out a form
- Briefing implies business planning
- Sets tone: ALPA is a commercial assistant

**Implementation:** Rename component, update copy, adjust visual hierarchy

---

### Refinement 2: Refinement Step (User Agency)
**Change:** After seeing results, allow optional filtering before selection

**New step:**
```
Results: "I found 84 businesses"
    ↓
Refinement (optional):
├─ Industry?
├─ Location?
├─ Company Size?
└─ CI Signals?
    ↓
Selection: "How many would you like to reach?"
```

**Why it matters:**
- Gives user time to think
- Leverages existing My Leads capabilities (filters, CI)
- Reduces selection paralysis
- Feels like discovery, not constraint

**Implementation:** Add RefinementOptions component with 4 filter options

---

### Refinement 3: Campaign Brief (Confirmation Point)
**Change:** Before any AI work, show clear campaign summary

**New component:**
```
Campaign Brief
├─ Offering: {value}
├─ Audience: {value}
├─ Goal: {value}
├─ Matching Businesses: {count}
├─ Selected: {count}
└─ Preparation Mode: {level}

[Start Preparing Outreach] ← Single CTA
```

**Why it matters:**
- User sees exactly what's about to happen
- Confirmation point before AI generation
- Reduces surprise or mistake
- Transparency builds trust

**Implementation:** Add CampaignBrief component before outreach preparation

---

### Refinement 4: Language Refinements (Assistant Tone)
**Changes throughout:**
- "Offering" instead of "selling"
- "Would benefit" instead of "targeting"
- "Looking through your business library" instead of "searching repository"
- "I found X businesses" instead of technical display
- "Campaign Goal" instead of "CTA"
- "Outreach Preparation" instead of "message generation"
- "Prepare your outreach" instead of "create messages"

**Why it matters:**
- Makes ALPA feel like an assistant, not software
- Customer-first language
- Channel-agnostic (works for SMS, LinkedIn, voice)
- More human, less technical

**Implementation:** Update all copy, component labels, and heading text

---

### Refinement 5: Progressive Automation Ladder
**Change:** Refine language to emphasize user control and progressive help

**Before:**
- "I'll write everything myself"
- "Help me personalize each business"
- "Generate everything for me"

**After:**
- "I'll prepare everything myself"
- "AI helps me personalize"
- "AI prepares everything for review"

**Plus:**
- Show effort/speed tradeoff
- Emphasize user remains in control
- "AI assists" not "AI replaces"

**Why it matters:**
- Makes progression clearer
- Reduces AI anxiety (user always reviews)
- Matches preparation language
- Progressive, not forced

**Implementation:** Update AutomationLadder component text and descriptions

---

## Component Hierarchy Changes

### Before
```
ProspectingWorkspace
├─ IntentQuestionsFlow
│  ├─ Q1, Q2, Q3
├─ RepositoryCheck
├─ CapacityQuestion
├─ AutomationLadder
└─ MessageCreation
```

### After
```
ProspectingWorkspace
├─ CommercialBriefing
│  ├─ Q1, Q2, Q3 (refined language)
├─ RepositorySearch (refined language)
├─ RepositoryResults (refined display)
├─ RefinementOptions ← NEW
├─ CapacitySelection (refined display)
├─ CampaignBrief ← NEW
├─ AutomationLadder (refined language)
└─ OutreachPreparation
```

**New components:**
1. **RefinementOptions** — Optional filters (Industry, Location, Size, CI)
2. **CampaignBrief** — Confirmation summary before preparation starts

**Modified components:**
1. **CommercialBriefing** — Renamed, language refined
2. **RepositorySearch/Results** — Language refined ("Looking through…", "I found…")
3. **AutomationLadder** — Language refined (progressive, user control focused)

---

## Why These Changes Don't Break Architecture

### All ADRs Still Intact
- ✅ **ADR-001** — My Leads still repository; Prospecting still queries only
- ✅ **ADR-002** — Database still authoritative; session state still ephemeral
- ✅ **ADR-003** — CI still immutable; only read for context
- ✅ **ADR-004** — Module boundaries unchanged; Prospecting still orchestrates

### Zero Data Model Changes
- ✅ No new database tables
- ✅ No new columns
- ✅ No schema migrations
- ✅ No new entities

### Zero Module Changes
- ✅ My Leads unchanged (still repository)
- ✅ Discover unchanged (still discovery)
- ✅ CI unchanged (still immutable)
- ✅ Outreach Queue unchanged (still drafts storage)

### Admin-Only Preserved
- ✅ Uses existing access control
- ✅ No permission changes
- ✅ Consistent with other admin modules

---

## Implementation Effort

### New Components to Build
1. **RefinementOptions** — Filter UI (1-2 hours)
2. **CampaignBrief** — Summary display (1 hour)

### Components to Refine (Language/UX)
1. **CommercialBriefing** — Text and tone (1 hour)
2. **RepositoryResults** — Display language (30 min)
3. **CapacitySelection** — Display refinement (30 min)
4. **AutomationLadder** — Text and descriptions (1 hour)

### Total New Work
- **New components:** ~3 hours
- **Refinements:** ~4 hours
- **Total:** ~7 hours (still within Phase 1 timeline)

### Phases Unchanged
- **Phase 1:** 3-4 days (includes refinements)
- **Phase 2:** 2 days (Discover integration)
- **Phase 3:** Ongoing (AI enhancements)

---

## User Experience Improvement

### Before Refinement
User mental model: "I'm filling out a form to prepare outreach"
- Feels mechanical
- Each step is a requirement
- No agency in selection
- Technical language

### After Refinement
User mental model: "I'm working with an assistant to prepare today's outreach"
- Feels natural
- Each step is part of planning
- User can refine before committing
- Commercial language

### Specific Improvements
1. **Less wizardy** — Briefing vs. questions
2. **More assistive** — "I found" vs. "Found"
3. **More control** — Can refine before selecting
4. **More transparent** — Campaign Brief shows everything before starting
5. **More natural** — "Offering" and "benefit" vs. "selling" and "targeting"
6. **Future-proof** — "Outreach Preparation" vs. "message generation"

---

## Refinement Checklist

- [x] Reframe entry as "Commercial Briefing" (not wizard)
- [x] Refine Q1: "offering" language
- [x] Refine Q2: "would benefit" language
- [x] Keep Q3 same (already good)
- [x] Refine repository language ("Looking through business library")
- [x] Add optional RefinementOptions step
- [x] Refine CapacitySelection display
- [x] Add CampaignBrief confirmation
- [x] Refine AutomationLadder language
- [x] Use "Outreach Preparation" terminology
- [x] Verify all ADRs still intact
- [x] Verify no database changes
- [x] Verify admin-only preserved
- [x] Verify module boundaries unchanged

---

## What Developers Should Know

### When Building Refinements

1. **CommercialBriefing component:**
   - Use "What are you offering today?" as label
   - Show examples as chips/pills above input
   - Placeholder: example of user input
   - Keep all logic same (just UX refinement)

2. **RefinementOptions component:**
   - Four filter options: Industry, Location, Size, CI Signals
   - Each filter is optional (user can skip all)
   - Show live count update as filters change
   - "Refine" button applies all filters

3. **CampaignBrief component:**
   - Display full briefing summary
   - Single primary CTA: "Start Preparing Outreach"
   - Secondary CTA: "Go back to refine"
   - No edits from here (go back if changes needed)

4. **Language everywhere:**
   - "Looking through your business library" (vs. "Searching repository")
   - "I found X businesses" (vs. technical display)
   - "Outreach Preparation" (vs. "message generation")
   - "Campaign Goal" (vs. "CTA")

---

## Backward Compatibility

- ✅ All existing workflows still work
- ✅ Existing My Leads integration unchanged
- ✅ Existing Discover integration unchanged
- ✅ Existing CI consumption unchanged
- ✅ No data migration needed
- ✅ No API changes

---

## Summary

**This refinement takes the solid architectural foundation and makes it feel human and assistive instead of technical and mechanical.**

Key changes:
1. Reframe as commercial briefing (not wizard)
2. Refined language throughout (assistant tone)
3. Add refinement step (user agency)
4. Add campaign brief (confirmation)
5. Emphasize user control (progressive automation)

Result: ALPA feels like a commercial assistant helping you prepare outreach, not software you're operating.

**Zero architectural changes. All ADRs preserved. Ready for implementation.**

---

**Next:** Review refinements, approve, then proceed to Phase 1 implementation with these UX principles in place.

