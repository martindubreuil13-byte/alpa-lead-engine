# Prospecting: Design Complete & Ready for Implementation

**Status:** ✅ APPROVED IN PRINCIPLE | ✅ REFINED FOR UX | ✅ READY FOR CODE  
**Date:** 2026-07-08  
**What's been delivered:** Complete UX design with commercial assistant tone, zero architectural changes

---

## What You Asked For

> Design Prospecting around three simple questions. Make it feel like a commercial assistant, not software. Refine the UX before implementation.

## What You're Getting

**A Prospecting workspace that:**

1. **Starts with commercial intent** — "What are you offering? Who would benefit? What's your goal?"
2. **Feels like an assistant** — "Looking through your business library… I found 84 businesses matching your objective."
3. **Respects user agency** — Optional refinement before selection, campaign brief before action
4. **Preserves everything** — All ADRs, admin-only, no database changes, same architecture
5. **Enables tomorrow** — Channel-agnostic language, progressive automation, scalable foundation

---

## The Refined Flow

```
"Let's prepare your outreach today."
    ↓
[Commercial Briefing]
├─ What are you offering today?
├─ Who would benefit most from it?
└─ If someone receives your message, what would you like them to do?
    ↓
"Looking through your business library…"
    ↓
[Results]
"I found 84 businesses matching your objective."
    ↓
[Optional Refinement]
├─ Filter by Industry?
├─ Filter by Location?
├─ Filter by Company Size?
└─ Filter by CI Signals?
    ↓
How many businesses would you like to reach today? (25 out of 84)
    ↓
[Campaign Brief — Confirmation]
┌────────────────────────────┐
│ Offering: AI Coaching       │
│ Audience: Marketing Agencies│
│ Goal: Book a discovery call  │
│ Matching: 84 | Selected: 25  │
│ Mode: AI helps personalize   │
└────────────────────────────┘
    ↓
[Start Preparing Outreach]
    ↓
[Outreach Preparation Begins]
```

---

## Five Key Refinements Made

### 1. Commercial Briefing (Not a Wizard)
**Why:** "Briefing" implies business planning; "wizard" implies form-filling
**Effect:** Sets tone from the start—ALPA is a commercial assistant

### 2. Refined Language
- "Offering" not "selling" (value-based)
- "Would benefit" not "targeting" (customer-first)
- "Looking through your business library" not "searching repository" (human, not technical)
- "Campaign Goal" not "CTA" (clear, commercial)
- "Outreach Preparation" not "message generation" (channel-agnostic)

**Effect:** Every word makes ALPA feel like a partner, not a tool

### 3. Refinement Step (New)
**What:** After finding businesses, optionally filter by Industry, Location, Size, CI Signals
**Why:** Gives user agency before selection, prevents paralysis
**Effect:** User feels in control; refinement feels like discovery

### 4. Campaign Brief (New)
**What:** Before any AI work, show full summary and get explicit user confirmation
**Why:** Transparency builds trust; confirmation prevents mistakes
**Effect:** User sees exactly what's happening before automation begins

### 5. Progressive Automation
**Language:** "I'll prepare myself" → "AI helps me" → "AI prepares for review"
**Emphasis:** User always reviews; AI assists, doesn't replace
**Effect:** Reduces AI anxiety; makes automation feel optional, not forced

---

## What Stays Exactly the Same

✅ **All 4 ADRs preserved:**
- ADR-001: My Leads is repository (Prospecting queries, never owns)
- ADR-002: Database is authoritative (session state ephemeral)
- ADR-003: CI immutable (read-only consumption)
- ADR-004: Module boundaries (Prospecting orchestrates)

✅ **Zero database changes:**
- No new tables
- No new columns
- No migrations
- Uses existing schema entirely

✅ **All modules unchanged:**
- My Leads: Still repository, no changes
- Discover: Still discovery, just new entry point
- CI: Still immutable, just read for context
- Outreach Queue: Still drafts, no changes

✅ **Admin-only preserved:**
- Prospecting accessible only to admin users
- Same access control as Outreach Queue, Pipeline
- No public user exposure

---

## Implementation Timeline

| Phase | Timeline | What | Effort |
|-------|----------|------|--------|
| **Phase 1** | 3-4 days | Core workflow (briefing → search → refine → automate) | 21 hours |
| **Phase 2** | 2 days | Discover integration (auto-discovery when needed) | 10 hours |
| **Phase 3** | Ongoing | AI enhancements (recommendations, personalization, generation) | 20-50 hours |

**Phase 1 MVP:** ~5 days start-to-finish
**Phase 1 + 2:** ~1 week start-to-finish

---

## Complete Design Package

### For Your Review Now:
1. **PROSPECTING_UX_REFINEMENT.md** — All refinements explained
2. **PROSPECTING_REFINEMENT_SUMMARY.md** — Changes at a glance
3. **PROSPECTING_IMPLEMENTATION_ROADMAP.md** — Detailed build plan with time estimates

### For Developers After Approval:
1. **PROSPECTING_IMPLEMENTATION_ROADMAP.md** — Phase-by-phase breakdown
2. **PROSPECTING_WORKSPACE_DESIGN.md** — Complete technical spec
3. **PROSPECTING_ARCHITECTURE_ALIGNMENT.md** — Proof ADRs are preserved

---

## Quality Assurance Approach

### Phase 1 Testing
- All components tested independently
- Full workflow tested end-to-end
- Session persistence verified
- My Leads search integration tested
- Admin-only access verified

### Phase 2 Testing
- Discover integration seamless
- Auto-return flow works
- Session merges correctly
- No state loss

### Phase 3 Testing (Per enhancement)
- AI output quality verified
- Edge cases handled
- Performance acceptable

---

## Rollout Plan

### Day 1
- Deploy Phase 1 (core workflow)
- Available to admin users only
- Monitor for issues

### Week 2
- Deploy Phase 2 (Discover integration)
- Test seamless discovery flow

### Week 3+
- Deploy Phase 3 enhancements as ready
- Monitor usage patterns
- Iterate based on feedback

---

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|-----------|
| Breaking existing workflows | None | Zero architectural changes; backward compatible |
| Database issues | None | No schema migrations; uses existing tables |
| Admin-only breach | None | Uses existing access control; no changes to auth |
| Performance | Low | Leverages existing My Leads search; no new queries |
| AI quality (Phase 3) | Medium | Output reviewed before deployment; quality bar set |

---

## Success Criteria

**Phase 1:** User completes full briefing → refinement → automation selection workflow naturally (70%+ completion rate)

**Phase 2:** Discover recommendation and auto-return work seamlessly (< 1 second overhead)

**Phase 3:** AI enhancements improve draft quality and save user time (measurable improvement over Level 1 manual)

---

## Before We Begin Implementation

Please confirm:

- [ ] Commercial assistant tone is the right direction?
- [ ] Three-question briefing feels like the right questions?
- [ ] Refinement step (optional filters) makes sense?
- [ ] Campaign Brief as confirmation point is good?
- [ ] Progressive automation ladder appropriate?
- [ ] Phase 1 → Phase 2 → Phase 3 timeline works?
- [ ] Ready to proceed to implementation?

---

## Next Action

**If approved:** Begin Phase 1 implementation (3-4 days)

**If modifications needed:** Update design documents and resubmit

**Timeline:** Phase 1 MVP ready in ~5 calendar days (3-4 working days)

---

## Summary Statement

**Prospecting is designed as a commercial assistant that helps users move from "What am I selling today?" to "Let's prepare outreach to 25 matching businesses." Every word, every step, every design decision reinforces that ALPA is a partner in the user's commercial work, not a software tool to operate.**

**Zero architectural changes. All ADRs preserved. Admin-only throughout. Ready for implementation.**

---

**All design documents complete. Ready for your final approval to proceed to Phase 1 implementation.**

