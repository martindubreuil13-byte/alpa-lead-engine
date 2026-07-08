# Prospecting Implementation Roadmap

**Status:** IMPLEMENTATION READY  
**Date:** 2026-07-08  
**Scope:** Phase 1, 2, 3 with all UX refinements incorporated  
**All ADRs:** Preserved ✅ | Admin-only: Preserved ✅ | No schema changes: Confirmed ✅

---

## Phase 1: Core Workflow (3-4 days)

### Goal
Build the complete commercial briefing → refinement → automation workflow. User can go from commercial intent to outreach preparation.

### Components to Build (8 components)

#### 1. CommercialBriefing (Container)
- Manages state: Q1, Q2, Q3 answers
- Handles progression through three questions
- Validates input before next step
- Estimated time: 3 hours

**Sub-components:**
- **BriefingQuestion1**
  - Label: "What are you offering today?"
  - ExampleChips: [AI Coaching, Website Design, SEO Services, Accounting, Business Consulting]
  - TextInput (free text)
  - Validation: > 10 characters
  - Visual: Simple, focused
  - Time: 1 hour

- **BriefingQuestion2**
  - Label: "Who would benefit most from it?"
  - TextInput (free text, larger)
  - UncertainPrompt: "Not sure? AI can suggest business types and industries."
  - AIRecommendations (expandable, shows suggestions)
  - Validation: > 10 characters
  - Time: 1 hour

- **BriefingQuestion3**
  - Label: "If someone receives your message, what would you like them to do?"
  - GoalButtons: 6 options + custom
  - Options: 📅 Book a meeting, 📋 Request quotation, 🌐 Visit website, 🎬 Schedule demo, 💬 Reply to message, 📞 Call me
  - CustomOption: Free text if "other"
  - Label below: "This becomes your campaign goal."
  - Validation: Goal selected
  - Time: 1 hour

#### 2. RepositorySearch (Async)
- Triggers after Q3 answered
- Displays: "Looking through your business library…"
- Calls: My Leads search with intent-derived criteria
- Shows loading state
- Estimated time: 2 hours

**Flow:**
```
Input: 
- commercialIntent (Q1)
- audienceDescription (Q2)
- campaignGoal (Q3)

Process:
- Parse intent → search criteria
- Query My Leads
- Count matches
- Rank by CI relevance (if available)

Output:
- matchCount: number
- matchesByCI: { withCI: number, withoutCI: number }
- ready: boolean
```

#### 3. RepositoryResults
- Displays results from search
- Success case: "I found 84 businesses that match your objective."
- Insufficient case: "I only found 11 businesses. I recommend discovering a few more before starting outreach."
- Discover button (if insufficient)
- Estimated time: 1.5 hours

**Component states:**
- Loading: Spinner + "Looking through your business library…"
- Success (many): "I found X businesses matching your objective"
- Success (few): "I found X businesses. Recommend discovering more."
- Ready for next: Shows count, enables continue

#### 4. RefinementOptions (NEW)
- Optional: User can skip all filters
- Four filter types:
  - Industry (multi-select dropdown or pills)
  - Location (multi-select dropdown or pills)
  - Company Size (buttons: Startup, Mid-market, Enterprise)
  - CI Signals (checkboxes: Has CI data, Score > 8, Any business)
- Live count update: "Now you have X businesses matching all filters"
- Apply button
- Estimated time: 3 hours

**Data source:**
- Industry: From existing My Leads CI data or tags
- Location: From existing My Leads leads table
- Company Size: From existing My Leads CI or inferred
- CI Signals: From existing CI records

**No new data needed—all from existing schema**

#### 5. CapacitySelection
- Question: "How many businesses would you like to reach today?"
- Slider or number input
- Display: "You're selecting X out of Y businesses"
- Recommendation text: "We recommend starting with 20-30 for your first outreach."
- Min: 1, Max: (total filtered count)
- Default: 20 or 50% of total, whichever is smaller
- Estimated time: 1 hour

#### 6. CampaignBrief (NEW)
- Summary card showing entire campaign
- Displays:
  - Offering: {value from Q1}
  - Audience: {value from Q2}
  - Goal: {value from Q3}
  - Matching Businesses: {total count}
  - Selected: {user selected count}
  - Preparation Mode: {automation level from next step}
- Two buttons:
  - Primary: "Start Preparing Outreach"
  - Secondary: "Go back to refine"
- Estimated time: 1.5 hours

#### 7. AutomationLadder (Refined)
- Question: "How would you like to prepare your outreach?"
- Three cards (selected state shows highlight):
  - Option 1: "I'll prepare everything myself"
    - "You stay in control. ALPA personalizes contact info only."
    - "Effort: You do the work | Speed: Slower"
  - Option 2: "AI helps me personalize"
    - "You write a message. ALPA adapts it for each business."
    - "Effort: Balanced | Speed: Faster"
  - Option 3: "AI prepares everything for review"
    - "ALPA writes personalized messages for each business. You review."
    - "Effort: Minimal | Speed: Fastest"
- Selection persists to CampaignBrief
- Estimated time: 1.5 hours

#### 8. ProspectingWorkspace (Container)
- Orchestrates all components
- Manages state: currentStep, briefing, businesses, capacity, automationLevel
- Handles navigation: next/back
- Session storage: Persists state across page reloads
- Routes to outreach preparation when complete
- Estimated time: 2 hours

**State shape:**
```typescript
type ProspectingSession = {
  currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  briefing: {
    offering: string
    audience: string
    goal: string
  }
  repository: {
    totalMatches: number
    matchesWithCI: number
    matchesWithoutCI: number
  }
  filters: {
    industry?: string[]
    location?: string[]
    size?: string[]
    ciSignals?: string[]
  }
  filteredCount: number
  capacity: number
  automationLevel: 'manual' | 'personalize' | 'generate'
  businesses: string[] // IDs
}
```

### Phase 1 Timeline
| Component | Hours | Owner | Dependency |
|-----------|-------|-------|-----------|
| BriefingQuestion1 | 1 | FE | None |
| BriefingQuestion2 | 1 | FE | None |
| BriefingQuestion3 | 1 | FE | None |
| RepositorySearch | 2 | FE/BE | My Leads query |
| RepositoryResults | 1.5 | FE | RepositorySearch |
| RefinementOptions | 3 | FE | My Leads data |
| CapacitySelection | 1 | FE | RefinementOptions |
| CampaignBrief | 1.5 | FE | All above |
| AutomationLadder | 1.5 | FE | None (parallel) |
| ProspectingWorkspace | 2 | FE | All above |
| Testing | 2-3 | QA | All components |
| **Total** | **~21 hours** | | |

**Reality:** Components can be built in parallel; expected 3-4 days with one developer.

---

## Phase 2: Discover Integration (2 days)

### Goal
When repository has insufficient matches, seamlessly guide user to Discover, then auto-return with new businesses.

### Components/Changes

#### 1. DiscoverRecommendation (Conditional in RepositoryResults)
- Shows when: matchCount < threshold (e.g., 5)
- Text: "I only found 11 businesses. I recommend discovering a few more."
- Suggests: 3 AI-generated search ideas based on Q1 + Q2
- Button: "Use Discover"
- Estimated time: 2 hours

#### 2. Discover Entry Point Integration
- New route: `/dashboard/scraper?intent=<encoded>&return=prospecting`
- Encodes: { offering, audience, goal }
- Discover receives intent via search params
- Shows 3 auto-generated search suggestions
- Estimated time: 2 hours

#### 3. Auto-Return Flow
- After discovery completes, auto-redirect to:
  `/dashboard/prospecting?businesses=<ids>&source=discover`
- Prospecting auto-includes discovered businesses
- Shows: "Added 34 new businesses. Let's continue."
- Resume from RefinementOptions step
- Estimated time: 2 hours

#### 4. Session Persistence
- Discovered business IDs persisted to session
- Automatically merged with initial search results
- User sees updated count
- Estimated time: 1 hour

### Phase 2 Timeline
| Task | Hours | Owner |
|------|-------|-------|
| DiscoverRecommendation component | 2 | FE |
| Discover entry point params | 2 | FE/BE |
| Auto-return flow | 2 | FE |
| Session persistence | 1 | FE |
| Testing | 1-2 | QA |
| **Total** | **~10 hours** | |

**Reality:** ~2 days with one developer, can overlap with Phase 1 tail.

---

## Phase 3: AI Enhancements (Ongoing)

### 3.1: AI Recommendations for Q2
**When:** User leaves Q2 empty or clicks "Not sure?"
**What:** AI suggests industries, business types, customer profiles
**Implementation:**
- API endpoint: `/api/prospecting/suggest-audience`
- Input: { offering (Q1) }
- Output: [{ type: industry, name: 'Technology' }, ...]
- Time: 4-6 hours

### 3.2: AI Personalization (Automation Level 2)
**When:** User selects "AI helps me personalize"
**What:** User writes template → ALPA personalizes per business
**Implementation:**
- Template editor component
- Personalization engine: uses company name, industry, CI signals
- Preview per business
- Time: 8-12 hours

### 3.3: AI Message Generation (Automation Level 3)
**When:** User selects "AI prepares everything for review"
**What:** ALPA generates full personalized message per business
**Implementation:**
- AI prompt: offering + audience + goal + business context
- Generate message per business
- Batch generation (20-50 at a time)
- Review UI (user can edit each)
- Time: 12-16 hours

### Phase 3 Timeline
- 3.1 (AI Recommendations): 1-2 sprints
- 3.2 (AI Personalization): 2-3 sprints
- 3.3 (AI Generation): 2-3 sprints
- **Total:** 5-8 sprints (ongoing enhancement)

---

## Integration Points (No Changes)

### My Leads
- Query: Search by intent-derived criteria
- No changes to My Leads itself
- Uses existing search/filter capability
- Returns: business IDs + metadata

### Commercial Intelligence
- Consumed for: audience relevance, personalization hints
- No changes to CI storage or immutability
- Read-only access
- Uses existing CI records

### Discover
- Entry point: Query param integration (new route option)
- No changes to Discover workflow
- Returns: newly created business IDs
- Auto-redirect back to Prospecting

### Outreach Queue
- Target: Drafts created during preparation
- No changes to Outreach Queue itself
- Uses existing `outreach_queue` table
- Follows existing draft model

---

## Technical Dependencies

### Backend (Optional)
- AI recommendation endpoint (Phase 3.1)
- Search optimization (index on Intent-derived criteria)
- No database migrations needed

### Frontend
- New components (8 in Phase 1)
- Session state management
- Routing integration
- No build process changes

### Infrastructure
- No new infrastructure
- Uses existing Supabase, Vercel, etc.
- Scales with existing infrastructure

---

## Quality Assurance Plan

### Phase 1 Testing
- [ ] CommercialBriefing: All three questions work, validation passes
- [ ] RepositorySearch: Returns correct count, handles no results
- [ ] RefinementOptions: Filters work independently and together
- [ ] CapacitySelection: Slider works, bounds enforced
- [ ] CampaignBrief: Displays all data correctly
- [ ] AutomationLadder: Selection persists, three options distinct
- [ ] ProspectingWorkspace: State management, navigation, session storage
- [ ] End-to-end: User can complete full flow from Q1 to CampaignBrief

### Phase 2 Testing
- [ ] DiscoverRecommendation shows when count < threshold
- [ ] Discover receives intent params correctly
- [ ] Auto-return flow works, businesses included
- [ ] Session merges discovered + initial search results

### Phase 3 Testing
- [ ] AI recommendations appear, are relevant
- [ ] Template personalization works per business
- [ ] Message generation produces coherent output
- [ ] Batch generation completes without errors

---

## Rollout Strategy

### Admin-Only From Day 1
- Prospecting accessible only to admin users
- Matches existing admin modules (Outreach Queue, Pipeline)
- No public user exposure
- Can test with power users before wider rollout

### Feature Flag (Optional)
- Could gate Prospecting behind feature flag
- Not required (admin-only is sufficient)
- Allows gradual rollout if desired

### Monitoring
- Track completion rates (Q1 → CampaignBrief)
- Track discovery recommendations (Phase 2)
- Track automation level selection
- Track outreach preparation success

---

## Deployment Checklist

### Phase 1 Pre-Deployment
- [ ] All components built and tested
- [ ] Session storage works across page reloads
- [ ] My Leads search integration tested
- [ ] Error handling for empty results
- [ ] Responsive design verified
- [ ] Admin-only access verified
- [ ] Code reviewed

### Phase 2 Pre-Deployment
- [ ] Discover integration tested
- [ ] Auto-return flow tested
- [ ] Session merge tested
- [ ] Search suggestion accuracy verified

### Phase 3 Pre-Deployment (Per enhancement)
- [ ] AI endpoint tested with sample data
- [ ] Output quality verified
- [ ] Edge cases handled
- [ ] Performance acceptable

---

## Success Criteria

### Phase 1
- ✅ User can complete full briefing → refinement → automation selection workflow
- ✅ Session persists across page reloads
- ✅ My Leads search returns relevant businesses
- ✅ Campaign Brief shows accurate summary
- ✅ Conversion rate (starts → completes) > 70%

### Phase 2
- ✅ Discover recommendation appears when needed
- ✅ Auto-return flow works seamlessly
- ✅ New businesses merge correctly with existing
- ✅ No loss of user state

### Phase 3
- ✅ AI recommendations are relevant and useful
- ✅ Personalization creates coherent customized messages
- ✅ Generation produces high-quality draft messages
- ✅ User trust in AI output high

---

## Timeline Overview

```
Week 1 (Phase 1): 3-4 days
├─ Mon-Tue: Core components (BriefingQuestions, RepositorySearch)
├─ Wed-Thu: Refinement + Selection (RefinementOptions, CampaignBrief)
└─ Fri: Automation ladder + integration testing

Week 2 (Phase 2): 2 days (can start mid-week 1)
├─ Mon-Tue: Discover integration

Week 3+ (Phase 3): Ongoing
├─ AI recommendations
├─ AI personalization
└─ AI generation

Total to MVP: ~5 days
Total to full initial vision: ~2-3 weeks
```

---

## Backward Compatibility

- ✅ No breaking changes to My Leads
- ✅ No breaking changes to Discover
- ✅ No breaking changes to Outreach Queue
- ✅ No database migrations
- ✅ Existing workflows still work
- ✅ Admin-only access preserved

---

## Summary

**Prospecting is buildable in 3 phases:**

1. **Phase 1 (3-4 days):** Core workflow (briefing → search → refinement → automation)
2. **Phase 2 (2 days):** Discover integration (seamless discovery when needed)
3. **Phase 3 (Ongoing):** AI enhancements (progressive automation)

**All phases preserve:**
- ✅ All 4 ADRs
- ✅ Admin-only access
- ✅ Zero database changes
- ✅ Module boundaries
- ✅ Backward compatibility

**User experience:**
- Starts with commercial intent (not data management)
- Feels like working with an assistant
- Progressive automation without forced AI
- Full transparency before any work begins

**Ready to begin Phase 1 implementation.**

