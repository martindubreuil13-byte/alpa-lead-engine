# Prospecting: UX Refinement Pass

**Status:** REFINED DESIGN (Human-first, commercial assistant tone)  
**Date:** 2026-07-08  
**Scope:** UX language, flow, hierarchy, and terminology  
**Constraint:** Zero architectural changes; all ADRs preserved

---

## Core Reframing

### Before: Software Wizard Pattern
"Intent Questions" → "Repository Search" → "Capacity Question" → "Automation Ladder"

**Feels like:** Filling out a form to use software

### After: Commercial Assistant Pattern
"Commercial Briefing" → "Business Library Search" → "Refinement Options" → "Campaign Brief" → "Outreach Preparation"

**Feels like:** Preparing today's outreach with an assistant who knows your business

---

## Refined UX Flow

```
[Welcome state: "Let's prepare your outreach today."]
    ↓
Commercial Briefing (3 questions, natural language)
    ├─ Q1: What are you offering today?
    ├─ Q2: Who would benefit most from it?
    └─ Q3: If someone receives your message, what would you like them to do?
    
    ↓ [User completes briefing]
    
[ALPA's turn]
"Looking through your business library…"
    
    ↓ [Search results]
    
Matching Businesses
├─ "I found 84 businesses that match."
└─ OR "I found only 11 businesses. I recommend discovering more."

    ↓ [User reviews results]
    
Refinement Options (optional)
├─ Filter by Industry
├─ Filter by Location
├─ Filter by Company Size
└─ Filter by Commercial Intelligence signals

    ↓ [User refines if desired]
    
Selection
"How many businesses would you like to reach today?"
[Slider: show refined count]

    ↓ [User selects count]
    
Campaign Brief (confirmation)
┌─────────────────────────────┐
│ Offering: AI Coaching        │
│ Audience: Marketing Agencies │
│ Goal: Book a discovery call   │
│ Matching businesses: 84       │
│ Selected: 25                  │
│ Preparation mode: AI helps    │
└─────────────────────────────┘

[Start Preparing Outreach] ← Single call-to-action

    ↓
[Outreach preparation begins]
```

---

## Question 1: What Are You Offering Today?

### Current Design
```
"What are you selling today?"
[Text input]
"e.g., B2B SaaS accounting software..."
```

### Refined Design
```
What are you offering today?

[Examples]
• AI Coaching
• Website Design  
• SEO Services
• Accounting
• Business Consulting

[Free text input]
"AI coaching for marketing teams"
```

**Changes:**
- "offering" instead of "selling" (less transactional, more value-based)
- Examples moved above input (shows pattern before user types)
- Placeholder shows actual user example (not generic)

**Why:** "Offering" feels like you're helping, not selling. Examples show what kinds of answers we expect.

---

## Question 2: Who Would Benefit Most From It?

### Current Design
```
"Who is most likely to benefit?"
[Large text input]
"Marketing departments at mid-size tech companies"
[Expandable: AI Recommendations]
```

### Refined Design
```
Who would benefit most from it?

[Free text input - customer-first focus]
"Marketing directors at tech companies"

[If user seems uncertain, offer]
"Not sure? AI can suggest business types and industries."
[Expandable: Suggestions]
```

**Changes:**
- Question reframed as customer-first, not "targeting"
- AI help is offered, not intrusive
- "Not sure?" makes exploration feel natural

**Why:** Customer benefit is different than "targeting". Helps user think like a customer, not a marketer.

---

## Question 3: Campaign Goal

### Current Design
```
"What would you like them to do?"
[6 button options]
• Book a meeting
• Request a quotation
• Visit my website
• Schedule a demo
• Reply to my email
• Call me
[Custom option]
```

### Refined Design
```
If someone receives your message, what would you like them to do?

[Button options - same, just clearer context]
📅 Book a meeting
📋 Request a quotation
🌐 Visit my website
🎬 Schedule a demo
💬 Reply to my email
📞 Call me
✏️ Custom goal

"This becomes your campaign goal."
```

**Changes:**
- Clearer question context ("If someone receives...")
- Label as "campaign goal" below (not "CTA")
- Icons remain for visual clarity

**Why:** Makes the goal feel like a natural conversation outcome, not a conversion metric.

---

## Repository Check: Human Language

### Current Design
```
"Searching repository…"
[Loading state]

Result:
"Found 47 businesses in your repository matching:
'Marketing departments at mid-size tech companies'"
```

### Refined Design
```
[As search happens, human language]
"Looking through your business library…"

[Results]
Success case:
"I found 84 businesses that match your objective."

Insufficient case:
"I only found 11 businesses. I recommend discovering a few more before starting your outreach.

Interested in a quick discovery search?"
[Discover button]
```

**Changes:**
- "Looking through your business library" (not "searching repository")
- "match your objective" (not technical language)
- "I recommend" (assistant tone)
- Discovery invitation is natural, not forced

**Why:** Feels like an assistant helping, not a database query. Language is conversational.

---

## Refinement: Optional Filtering

### Before (Not in Previous Design)
```
[After repository shows results]
"How many businesses would you like to reach?"
[Immediately to selection]
```

### After (New Step)
```
[After repository shows results: 84 matches]

"Before you select, would you like to narrow these down?"

Filter Options (optional):
┌─ Industry ────────────────┐
│ All | Technology | Finance│
│ Healthcare | Retail       │
└────────────────────────────┘

┌─ Location ────────────────────┐
│ All | US | EU | California   │
└──────────────────────────────┘

┌─ Company Size ──────────────┐
│ All | Startup | Mid-market   │
│ Enterprise                   │
└─────────────────────────────┘

┌─ Commercial Intelligence ───┐
│ Has CI data | Score > 8     │
│ Any business                │
└─────────────────────────────┘

[Apply filters]

Result after filtering:
"Now you have 28 businesses matching all filters."
```

**Why this step exists:**
- User has time to think, not rushed into selection
- Filters leverage existing My Leads data (CI, tags, etc.)
- Refinement feels like discovery, not constraint
- Reduces "how many should I pick?" paralysis

---

## Selection: Capacity Question (Refined)

### Before
```
"How many businesses would you like to reach today?"
[Slider: 1 to max]
Default: 20
```

### After
```
How many businesses would you like to reach today?

[Slider showing: "You're selecting 25 out of 28 businesses"]

Recommendation: "Start with 20-30 for your first outreach."

[Selection confirmed]
```

**Changes:**
- Show actual count vs. available count
- Soft recommendation (not forcing)
- "Reach" language (not "email")

**Why:** Users feel more in control when they see the math. Recommendation is a suggestion, not a mandate.

---

## Campaign Brief: Confirmation Point

### New Component (Critical UX Addition)

Before any AI work begins, show a clear summary:

```
┌──────────────────────────────────────────┐
│        CAMPAIGN BRIEF                    │
├──────────────────────────────────────────┤
│                                          │
│ Offering                                 │
│ AI Coaching                              │
│                                          │
│ Audience                                 │
│ Marketing Directors at Tech Companies    │
│                                          │
│ Goal                                     │
│ Book a discovery call                    │
│                                          │
│ Matching Businesses                      │
│ 28 (after filters)                       │
│                                          │
│ Selected for Outreach                    │
│ 25                                       │
│                                          │
│ Preparation Mode                         │
│ AI helps me personalize                  │
│                                          │
└──────────────────────────────────────────┘

           [Start Preparing Outreach]
           
       or [Go back to refine]
```

**Why this exists:**
- Confirmation point before AI generation
- User sees exactly what they're about to do
- Can review before committing
- Single CTA (clean, focused)
- "Start Preparing Outreach" is human language

---

## Automation Ladder: Progressive Language

### Before
```
"How would you like to create messages?"

├─ I'll write everything myself
├─ Help me personalize each business
└─ Generate everything for me
```

### After
```
How would you like to prepare your outreach?

┌──────────────────────────────┐
│ I'll prepare everything      │
│ myself.                      │
│                              │
│ You stay in control.         │
│ ALPA personalizes contact    │
│ information only.            │
│                              │
│ Effort: You do the work      │
│ Speed: Slower                │
└──────────────────────────────┘

┌──────────────────────────────┐
│ AI helps me personalize.     │
│                              │
│ You write a message.         │
│ ALPA adapts it for each      │
│ business using what it knows │
│ about them.                  │
│                              │
│ Effort: Balanced             │
│ Speed: Faster                │
└──────────────────────────────┘

┌──────────────────────────────┐
│ AI prepares everything       │
│ for review.                  │
│                              │
│ ALPA writes personalized     │
│ messages for each business.  │
│ You review and adjust.       │
│                              │
│ Effort: Minimal              │
│ Speed: Fastest               │
└──────────────────────────────┘

[Selected: AI helps me personalize]
```

**Changes:**
- "Prepare" instead of "create" (matches outreach terminology)
- Progressive framing: effort and speed trade-offs
- Emphasis on user remaining in control
- "AI prepares for review" not "generates everything"

**Why:** Makes it clear the user is always in charge. AI is assistant, not replacement.

---

## Page Structure: Refined Component Hierarchy

```
ProspectingWorkspace
│
├─ PageHeader
│  ├─ Breadcrumb: Dashboard > Prospecting
│  └─ "Let's prepare your outreach today."  ← Tone-setting headline
│
├─ CommercialBriefing (state: completed)
│  │
│  ├─ BriefingQuestion1
│  │  ├─ QuestionText: "What are you offering today?"
│  │  ├─ ExampleChips (AI Coaching, Website Design, etc.)
│  │  ├─ TextInput
│  │  └─ NextButton
│  │
│  ├─ BriefingQuestion2
│  │  ├─ QuestionText: "Who would benefit most from it?"
│  │  ├─ TextInput
│  │  ├─ UncertainPrompt: "Not sure? AI can suggest..."
│  │  ├─ AIRecommendations (expandable)
│  │  └─ NextButton
│  │
│  └─ BriefingQuestion3
│     ├─ QuestionText: "If someone receives your message..."
│     ├─ GoalButtonGroup (6 options + custom)
│     ├─ Label: "This becomes your campaign goal."
│     └─ NextButton
│
├─ RepositorySearch (async)
│  └─ "Looking through your business library…"
│
├─ RepositoryResults
│  ├─ ResultsHeadline (success or insufficient)
│  ├─ CountDisplay: "I found 84 businesses"
│  └─ DiscoverOption (if insufficient)
│
├─ RefinementOptions (optional, collapsible)
│  ├─ IndustryFilter
│  ├─ LocationFilter
│  ├─ CompanySizeFilter
│  ├─ CISignalFilter
│  └─ RefineButton
│
├─ CapacitySelection
│  ├─ QuestionText: "How many would you like to reach?"
│  ├─ Slider with count display
│  ├─ Recommendation text
│  └─ ConfirmButton
│
├─ CampaignBrief (confirmation)
│  ├─ BriefCard
│  │  ├─ Offering: {value}
│  │  ├─ Audience: {value}
│  │  ├─ Goal: {value}
│  │  ├─ Matching: {count}
│  │  ├─ Selected: {count}
│  │  └─ PreparationMode: {level}
│  │
│  └─ ActionButtons
│     ├─ StartButton: "Start Preparing Outreach"
│     └─ BackButton: "Go back to refine"
│
└─ ProgressFooter
   └─ CurrentStep indicator
```

**Changes:**
- Added "CommercialBriefing" framing (not "Intent Questions")
- "RepositorySearch" (assistant language)
- Added "RefinementOptions" step
- "CampaignBrief" as explicit confirmation
- "StartButton" uses action language

---

## Terminology Mapping: Throughout UX

| Don't Use | Use Instead | Why |
|-----------|------------|-----|
| Intent Questions | Commercial Briefing | Broader, more human |
| Searching repository | Looking through your business library | Assistant tone |
| Capacity Question | Selection | More natural |
| Automation Ladder | Preparation modes | Less tech-y |
| Message generation | Outreach Preparation | Future-proof for channels |
| CTA | Campaign Goal | Less marketing-speak |
| Create messages | Prepare outreach | Consistent with product |
| Email | Message/Outreach | Channel-agnostic |

---

## Flow Diagram: User Journey

```
START
 │
 ├─ "Let's prepare your outreach today."
 │
 ├─ COMMERCIAL BRIEFING
 │  ├─ What are you offering?
 │  ├─ Who would benefit?
 │  └─ What's your goal?
 │
 ├─ [ALPA's turn: Looking through business library]
 │
 ├─ RESULTS
 │  ├─ "I found 84 businesses"
 │  └─ [Discover option if too few]
 │
 ├─ REFINEMENT (optional)
 │  ├─ Filter by Industry?
 │  ├─ Filter by Location?
 │  ├─ Filter by Size?
 │  └─ Filter by CI signals?
 │
 ├─ SELECTION
 │  └─ "How many would you like to reach?" (25 out of 84)
 │
 ├─ CAMPAIGN BRIEF
 │  ├─ Offering: AI Coaching
 │  ├─ Audience: Marketing Agencies
 │  ├─ Goal: Book a meeting
 │  ├─ Selected: 25
 │  └─ Mode: AI helps personalize
 │
 ├─ [START PREPARING OUTREACH]
 │
 └─ OUTREACH PREPARATION
    ├─ [User + AI collaborate]
    └─ Drafts ready for review
```

---

## Key UX Principles Refined

### 1. Start with Commercial Intent, Not Software Mechanics
**Before:** "Intent Questions" (felt like wizard)
**After:** "Commercial Briefing" (feels like business planning)

### 2. ALPA is an Assistant, Not a Tool
**Before:** "Searching repository" (technical)
**After:** "Looking through your business library" (human)

### 3. User Remains in Control
**Before:** Automation ladder with three options
**After:** Campaign Brief shows what's happening before any work begins

### 4. Refinement Feels Natural, Not Forced
**Before:** Ask questions, then search, then select
**After:** Show results, let user refine, then select

### 5. Language is Commercial, Not Technical
**Before:** "Message generation", "CTA", "capacity"
**After:** "Outreach Preparation", "Campaign Goal", "How many to reach"

### 6. Everything is Channel-Agnostic
**Before:** "Emails", "Send messages"
**After:** "Outreach", "Prepare outreach"

---

## What Stays the Same (Architecture Unchanged)

✅ **All ADRs intact:**
- ADR-001: My Leads is repository (still query, never own)
- ADR-002: Database is authoritative (still ephemeral session state)
- ADR-003: CI is immutable (still read-only consumption)
- ADR-004: Module responsibilities (still orchestrate, not own)

✅ **Zero database changes:**
- No new tables
- No new columns
- No schema migrations

✅ **Admin-only preserved:**
- Uses existing access control
- No changes to permission model

✅ **Existing modules untouched:**
- My Leads repository unchanged
- Discover module unchanged
- CI consumption same pattern
- Outreach Queue unchanged

---

## Implementation Implications

### New/Modified Components
```
ProspectingWorkspace (unchanged structure, refined language)
├─ CommercialBriefing (renamed from IntentQuestions)
│  ├─ BriefingQuestion1 (refine tone, add examples)
│  ├─ BriefingQuestion2 (add "Not sure?" prompt)
│  └─ BriefingQuestion3 (add goal label)
│
├─ RepositorySearch (refine language: "Looking through...")
├─ RepositoryResults (refine display language)
│
├─ RefinementOptions (NEW: optional filtering)
│  ├─ IndustryFilter
│  ├─ LocationFilter
│  ├─ CompanySizeFilter
│  └─ CISignalFilter
│
├─ CapacitySelection (refine display, show count vs. available)
│
├─ CampaignBrief (NEW: confirmation step)
│  └─ Shows full briefing before starting
│
└─ AutomationLadder (refine language, emphasize user control)
```

### Why These Changes
1. **CommercialBriefing:** Reframes as business planning, not form-filling
2. **RefinementOptions:** Gives user agency before selection
3. **CampaignBrief:** Confirmation point ensures user knows what happens next
4. **Language:** Throughout—assistant tone, human-first framing

---

## Why This Refinement Works

### For the User
- Feels like working with an assistant, not software
- Understands what's happening at each step
- Can refine before committing
- Remains in control of all decisions
- Language mirrors how they think about their business

### For the Product
- Channel-agnostic (email today, SMS/LinkedIn tomorrow)
- Progressive automation ladder feels natural
- Confirmation point before any AI generation
- Still uses same architecture foundation
- Scales to future features without redesign

### For the Business
- Improves conversion (less drop-off, clearer flow)
- Reduces support questions (clearer language)
- Enables future features (architecture unchanged)
- Maintains trust (user always in control)

---

## Summary of Changes

| Aspect | Before | After | Why |
|--------|--------|-------|-----|
| Entry framing | "Intent Questions" | "Commercial Briefing" | Business-first language |
| Q1 language | "What are you selling?" | "What are you offering?" | Value-based, not transactional |
| Q2 framing | "Who are you targeting?" | "Who would benefit?" | Customer-first thinking |
| Search language | "Searching repository" | "Looking through business library" | Assistant tone |
| Refinement | N/A | Add optional filtering | User agency before selection |
| Confirmation | N/A | Campaign Brief | Transparency before action |
| Automation | "Message generation" | "Outreach Preparation" | Channel-agnostic, user-centric |
| CTA | "Next button" | "Start Preparing Outreach" | Clear action language |

---

## Next Phase

This refinement is UX/language only. Implementation should:
1. ✅ Follow refined component hierarchy
2. ✅ Use refined language throughout
3. ✅ Add RefinementOptions step
4. ✅ Add CampaignBrief confirmation
5. ✅ Preserve all architectural decisions
6. ✅ Keep all ADRs intact
7. ✅ Maintain admin-only access

**No code changes needed to existing architecture.**
**Pure component refinement and language updates.**

---

**UX Refinement Complete. Ready for implementation with commercial assistant tone.**

