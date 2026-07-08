# Prospecting Workspace Design: Summary for Review

**Status:** DESIGN COMPLETE (UX flow, page structure, component hierarchy, implementation roadmap)  
**Date:** 2026-07-08  
**Intent:** Redesign user sequence around commercial intent while preserving all architectural foundations

---

## What Changed (Conceptually)

### Before: Data-First Journey
```
Dashboard → Select a business from My Leads → Create outreach
```

**User mental model:** "I have some businesses; what should I do with them?"

### After: Intent-First Journey
```
Dashboard → Answer: What am I selling? Who needs it? What do I want them to do?
→ ALPA finds matching businesses in My Leads
→ If not enough, discover more
→ Choose your level of assistance
→ Create outreach
```

**User mental model:** "I want to reach people who need what I'm selling. Do you have any?"

---

## The Three Questions

1. **What are you selling today?** (Free text)
   - Commercial context for entire workflow
   - Seeds AI recommendations

2. **Who is most likely to benefit?** (Free text + optional AI suggestions)
   - Narrowed target audience
   - Becomes My Leads search criteria

3. **What would you like them to do?** (Select from: meeting, quote, visit, demo, reply, call, or custom)
   - Campaign objective
   - Guides message generation

---

## The Flow

```
Questions 1-3
    ↓
[ALPA searches My Leads repository]
    ↓
"X businesses match your intent"
    ↓
Enough matches?
├─ YES → Continue with these businesses
│        ↓
│   How many to reach today? (slider)
│        ↓
│   How much help? (manual/personalize/generate)
│        ↓
│   [Message creation begins]
│
└─ NO → "Only X matches. Find more?"
         ├─ Suggest Discover with AI-generated search ideas
         └─ User discovers → Auto-returns with new businesses → Continue
```

---

## Key Design Principles

✅ **Start with commercial intent, not data**  
✅ **No forced AI—three automation levels**  
✅ **Intelligent discovery integration (optional)**  
✅ **Channel-agnostic ("reach", not just "email")**  
✅ **Session-based state (ephemeral, not persistent)**  
✅ **All businesses come from My Leads repository**  

---

## What Doesn't Change (Everything Preserved)

✅ **My Leads repository** — Still the business container, no changes  
✅ **Discover module** — Still finds businesses, just new entry point  
✅ **Commercial Intelligence** — Still immutable, just read for context  
✅ **Database schema** — No new tables, no migrations  
✅ **All ADRs (001-004)** — All principles remain valid  
✅ **Admin-only access** — Consistent with existing controls  
✅ **Existing workflows** — Backward compatible  

---

## Component Hierarchy

```
ProspectingWorkspace
├─ ProspectingFlow (state: step, intent, businesses)
│  ├─ CommercialIntentQuestion (Q1)
│  ├─ AudienceQuestion (Q2)
│  ├─ ObjectiveQuestion (Q3)
│  ├─ RepositoryCheckResults (My Leads search + optional Discover)
│  ├─ CapacityQuestion (Q4: how many)
│  ├─ AutomationLadder (Q5: help level)
│  └─ ProgressIndicator (5 steps)
└─ ProgressFooter (back/next)
```

**No breaking changes:** All existing components unchanged.

---

## Implementation Phases

### Phase 1: Core Flow (3-4 days)
- Six question/decision components
- Session state management
- Integration with My Leads search
- Auto-routing to message creation

### Phase 2: Discover Integration (2 days)
- Detect "not enough matches"
- AI-generated search suggestions
- Seamless navigation to Discover
- Auto-return to Prospecting with new businesses

### Phase 3: AI Enhancements (Ongoing)
- Industry/type suggestions for Q2
- Personalization hints for template builder
- Full message generation option

---

## What This Enables

**Today (MVP):**
- Intent-driven business discovery
- Three automation levels
- Manual message creation still fully supported

**Tomorrow (with AI):**
- AI industry recommendations
- AI-powered personalization
- AI full message generation
- Learning from campaign performance

**Future (with channels):**
- SMS workflows (same intent, different channel)
- LinkedIn outreach (same workflow, different delivery)
- Voice workflows (same automation ladder)
- Multi-channel campaigns (one intent, multiple channels)

---

## Architectural Integrity

**Why this design doesn't break anything:**

1. **My Leads stays repository** — Prospecting queries it, doesn't own it
2. **Database stays authoritative** — Session state is ephemeral
3. **CI stays immutable** — Prospecting only reads it
4. **Modules stay independent** — Prospecting orchestrates but doesn't own
5. **Admin-only preserved** — Uses existing access control
6. **Backward compatible** — Old flows still work

**See:** `PROSPECTING_ARCHITECTURE_ALIGNMENT.md` (detailed ADR alignment)

---

## Open Questions

Before proceeding to Phase 1 implementation:

**Design Questions:**
- [ ] Three-question framework feels right?
- [ ] Automation ladder sequence correct?
- [ ] Discover integration approach makes sense?
- [ ] Objective options complete? (meeting, quote, visit, demo, reply, call)

**Implementation Questions:**
- [ ] Phase 1 scope realistic (3-4 days)?
- [ ] Component hierarchy clear?
- [ ] Session state approach acceptable?
- [ ] Phased rollout (MVP, then AI, then channels) aligned with product strategy?

**Technical Questions:**
- [ ] Any concerns about no database changes?
- [ ] Any concerns about session-based state?
- [ ] Any concerns about My Leads search integration?

---

## What Happens Next (If Approved)

### Phase 1: Implementation
1. Build six UI components
2. Implement session state management
3. Connect to My Leads search
4. Create flow routing
5. Test end-to-end

### Phase 2: Discover Integration
1. Add "not enough matches" detection
2. Generate search suggestions from intent
3. Create Discover entry point with intent params
4. Auto-return flow from Discover

### Phase 3: AI (Future)
1. AI recommendation engine
2. Template personalization
3. Full message generation

---

## Success Criteria

After Phase 1, Prospecting should feel like:

✅ "I start by describing what I want to accomplish"  
✅ "ALPA finds the right businesses from my repository"  
✅ "It offers to help me find more if needed"  
✅ "I choose how much help I want with messages"  
✅ "Everything feels natural and flows from my intent"  
✅ "I'm never forced to use AI if I don't want to"  

---

## Documents for Reference

1. **PROSPECTING_WORKSPACE_DESIGN.md** — Complete UX specification
   - Three questions framework
   - Component specifications
   - Page structure
   - Flow diagrams
   - Implementation phases

2. **PROSPECTING_ARCHITECTURE_ALIGNMENT.md** — ADR alignment proof
   - How each ADR is respected
   - Data ownership matrix
   - No breaking changes analysis
   - Session state justification

3. This document — Summary for decision

---

## Decision Gate

**Please confirm:**

- [ ] Intent-first approach is the right direction
- [ ] Three questions feel like the right questions
- [ ] Automation ladder progression is good
- [ ] Discover integration approach works
- [ ] Approved to proceed to Phase 1 implementation

**Or request modifications:**
- Different questions?
- Different automation options?
- Different Discover integration?
- Different phasing?

---

## Next Steps (If Approved)

1. **Week 1:** Build Phase 1 components and integration
2. **Week 2:** Discover integration (Phase 2)
3. **Week 3+:** AI enhancements (Phase 3)

**Total MVP:** ~5 days of focused development

---

**Ready for your approval or requested modifications.**

