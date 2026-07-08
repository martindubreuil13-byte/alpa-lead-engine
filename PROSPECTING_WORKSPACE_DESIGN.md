# Prospecting Workspace Design

**Status:** DESIGN (UX flow, page structure, component hierarchy, roadmap)  
**Date:** 2026-07-08  
**Constraints:** No database redesign, no My Leads changes, no CI changes, no Discover changes, preserve all ADRs, keep admin-only

---

## Core Principle

**Prospecting starts with commercial intent, not with data.**

Users answer three questions about what they're selling and who benefits. ALPA then intelligently routes them to existing businesses or recommends discovery. This shifts the mental model from "manage my businesses" to "reach people who need what I'm selling."

---

## The Three Questions Framework

### Question 1: What Are You Selling Today?
**Purpose:** Establish commercial context for the entire workflow.

**UI:** Simple text input
```
"What are you selling today?"
[Text input field - medium size]
"e.g., B2B SaaS accounting software, freelance web design, consulting services"
```

**Data Flow:**
- Input: Free text
- Output: Commercial intent label (stored in session, not persisted)
- Use case: Seeds AI recommendations for Question 2

**Example User Inputs:**
- "CRM software for small businesses"
- "Executive coaching"
- "Cloud infrastructure services"
- "Social media management"

---

### Question 2: Who Is Most Likely to Benefit?
**Purpose:** Narrow target audience; foundation for My Leads search.

**UI:** Text input with optional AI recommendations
```
"Who is most likely to benefit?"
[Text input field - larger, allows multi-line]
[Expandable AI Recommendations button]

AI Suggestions (if expanded):
├─ Industry suggestions (e.g., "Finance", "Healthcare", "Retail")
├─ Business type (e.g., "Agencies", "Startups", "Enterprise")
└─ Customer profile (e.g., "Decision makers", "Marketing directors")
```

**Data Flow:**
- Input 1: Free text description (what the user types)
- Input 2: AI suggestions (if user accepts any)
- Output: Audience definition (stored in session)
- Use case: Becomes search filter for My Leads

**Examples:**
- User types: "Marketing departments at mid-size tech companies"
- User types: "Small business owners in healthcare"
- User accepts AI suggestion: "Finance directors, SaaS companies"

**AI Enhancement** (Phase 2):
- Given Question 1 input, suggest industries/types that commonly benefit
- Learn from previous campaigns (which audiences converted best)
- Personalize to this user's customer profile

---

### Question 3: What Would You Like Them to Do?
**Purpose:** Define campaign objective; foundation for message generation.

**UI:** Select from preset options + custom option
```
"What would you like them to do?"

[Button group with icons]
├─ 📅 Book a meeting
├─ 📋 Request a quotation
├─ 🌐 Visit my website
├─ 🎬 Schedule a demo
├─ 💬 Reply to my email
├─ 📞 Call me
└─ ✏️ Custom objective (text input)
```

**Data Flow:**
- Input: Selected objective (or custom text)
- Output: Campaign objective (stored in session)
- Use case: Directs message generation and personalization

**Why These Objectives:**
- All channel-agnostic (can be email, LinkedIn, voice, SMS, etc.)
- Clear conversion endpoint (can measure success)
- Inform tone and urgency of messaging

---

## Workflow: Intent → Repository Check → Maybe Discover

After the three questions, the flow is:

```
Question 1: What?
     ↓
Question 2: Who?
     ↓
Question 3: What do they do?
     ↓
[ALPA processes intent]
     ↓
Search My Leads Repository
     ↓
Does it match? → YES → Show count: "X businesses match"
                ↓
            Is X enough? → YES → Continue to Prospecting
                         ↓
                         NO → Recommend Discover
                              (show AI-generated search suggestions)
                              ↓
                              User runs discovery
                              ↓
                              Return to Prospecting
                              (businesses auto-included)
```

### Search Criteria Derived from Intent

**Question 2 inputs → Search My Leads:**

```
User Input: "Marketing departments at mid-size tech companies"

Derived Search Criteria:
├─ keyword_search: ["marketing", "tech"]
├─ industry_filter: ["Technology", "Software"]
├─ company_size_hint: ["mid-market"] (fuzzy match)
└─ ci_enrichment: Check commercial profile for marketing-related signals
```

**Search Algorithm:**
1. Parse Question 2 text for keywords
2. Check My Leads for businesses matching keywords
3. Apply CI signals (if available) to rank relevance
4. Count total matches

**Result Screen:**
```
✅ Found 47 businesses in your repository matching:
   "Marketing departments at mid-size tech companies"

   ├─ 12 Tech companies with identified marketing contacts
   ├─ 35 Additional tech companies (no marketing contact yet)
   └─ Use Discover to find more? (AI suggestions: "Marketing automation tools", "Marketing consultancies")

[Continue with these businesses]  [Use Discover first]
```

### Recommending Discovery

If matches are insufficient (< threshold, e.g., 5 businesses):

```
Only 2 businesses match. That's not many.

Would you like to use Discover to find more?
We suggest searching for:
├─ "Marketing departments at tech startups"
├─ "Digital marketing agencies"
└─ "SaaS marketing directors"

[Use Discover]  [Continue anyway]
```

**AI-Generated Suggestions Logic:**
- Parse Question 1 + Question 2
- Suggest variations and related searches
- Frame as "If you want to reach more X, try searching for Y"

**After Discovery:**
- New businesses automatically added to session
- Return to Prospecting: "Added 34 new businesses"
- Continue workflow from business selection

---

## Question 4: Capacity Question

After intent is clarified and businesses are gathered:

```
"How many businesses would you like to reach today?"

[Slider or number input]
[Show recommendation based on selected assistance level]

Min: 1
Max: (user's plan limit, or all matching businesses)
Default: 20

"We recommend starting with 20 for your first campaign."
```

**Purpose:**
- Don't force users to contact everyone
- Allows testing before full rollout
- Sets scope for assistance (below)

---

## Question 5: Automation Ladder

Progressive automation without forcing AI:

```
"How would you like to create messages?"

[Three cards, each showing example output]

┌─────────────────────────────────────────┐
│ ✍️  I'll write everything myself         │
│                                          │
│ Full control. You write all messages.    │
│ ALPA formats and personalizes contact   │
│ info (name, company, role).              │
│                                          │
│ Effort: High  |  Speed: Slow             │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 🤝 Help me personalize each business    │
│                                          │
│ You write a template. ALPA personalizes  │
│ it for each business using:              │
│ • Company name, industry, size           │
│ • Commercial Intelligence insights       │
│ • Contact person (if available)          │
│                                          │
│ Effort: Medium  |  Speed: Medium         │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 🚀 Generate everything for me            │
│                                          │
│ ALPA writes personalized messages for    │
│ each business using:                     │
│ • Your selling point (from Q1)           │
│ • Audience insight (from Q2)             │
│ • Campaign objective (from Q3)           │
│ • Business context (from My Leads)       │
│                                          │
│ Effort: Low  |  Speed: Fast              │
└─────────────────────────────────────────┘

Selected: [ I'll write everything myself ]
```

**Why This Ladder:**
- Respects user agency (not forcing AI)
- Progressive: start manual, add help as comfortable
- Each level is complete and usable
- Sets expectations for output quality

---

## Page Structure & Component Hierarchy

### Page: `/dashboard/prospecting`

```
ProspectingWorkspace (Main container)
│
├─ ProspectingHeader
│  ├─ Breadcrumb: Dashboard > Prospecting
│  └─ Title: "Prospecting"
│
├─ ProspectingFlow (State management: step, intent, businesses)
│  │
│  ├─ Step 1: CommercialIntentQuestion
│  │  ├─ QuestionCard
│  │  │  ├─ QuestionText
│  │  │  ├─ TextInput (what are you selling)
│  │  │  └─ NextButton
│  │  └─ ProgressIndicator (1/5)
│  │
│  ├─ Step 2: AudienceQuestion
│  │  ├─ QuestionCard
│  │  │  ├─ QuestionText
│  │  │  ├─ TextInput (who benefits)
│  │  │  ├─ AIRecommendations (expandable)
│  │  │  │  ├─ IndustrySuggestions
│  │  │  │  ├─ BusinessTypeSuggestions
│  │  │  │  └─ CustomerProfileSuggestions
│  │  │  └─ NextButton
│  │  └─ ProgressIndicator (2/5)
│  │
│  ├─ Step 3: ObjectiveQuestion
│  │  ├─ QuestionCard
│  │  │  ├─ QuestionText
│  │  │  ├─ ObjectiveButtonGroup
│  │  │  │  ├─ ObjectiveButton (Book meeting)
│  │  │  │  ├─ ObjectiveButton (Request quote)
│  │  │  │  ├─ ObjectiveButton (Visit website)
│  │  │  ├─ CustomObjectiveInput (if selected)
│  │  │  └─ NextButton
│  │  └─ ProgressIndicator (3/5)
│  │
│  ├─ Step 4: RepositoryCheck & Discovery
│  │  ├─ IntentSummary (displays Q1, Q2, Q3)
│  │  ├─ RepositorySearchResults
│  │  │  ├─ ResultCount (e.g., "47 businesses match")
│  │  │  ├─ ResultBreakdown
│  │  │  │  ├─ "12 with contact info"
│  │  │  │  └─ "35 without contact info"
│  │  │  └─ DiscoverRecommendations (conditional)
│  │  │     ├─ "Only 2 matches. Find more?"
│  │  │     ├─ SearchSuggestions
│  │  │     └─ DiscoverButton
│  │  └─ ContinueButton
│  │
│  ├─ Step 5: CapacityQuestion
│  │  ├─ QuestionCard
│  │  │  ├─ QuestionText
│  │  │  ├─ NumberSlider (1 to max)
│  │  │  └─ NextButton
│  │  └─ ProgressIndicator (4/5)
│  │
│  └─ Step 6: AutomationLadder
│     ├─ QuestionCard
│     │  ├─ QuestionText
│     │  ├─ AutomationOptionCards (3 options)
│     │  │  ├─ ManualCard
│     │  │  ├─ PersonalizeCard
│     │  │  └─ GenerateCard
│     │  └─ SelectionButton
│     └─ ProgressIndicator (5/5)
│
└─ ProgressFooter
   ├─ StepIndicator (showing 1/5, 2/5, etc.)
   ├─ BackButton
   └─ NextButton (context-sensitive text)
```

### Conditional Flows

**If Repository Check finds matches:**
```
Question 3 → Repository Check → Question 4 → Question 5 → Message Creation
```

**If Repository Check finds too few:**
```
Question 3 → Repository Check → [Recommend Discover]
                                    ↓
                            [User runs discovery]
                                    ↓
                            [Returns to Question 4]
```

**If User chooses Discover:**
- Navigate to `/dashboard/scraper?intent=<encoded-intent>&return=prospecting`
- Auto-populate search suggestions
- Automatically return to Prospecting after discovery
- Show: "Added 34 new businesses. Continuing..."

---

## Data Flow: Session State

Prospecting state (held in React component, not DB):

```typescript
type ProspectingSession = {
  // Intent questions
  commercialIntent: string          // Q1: What are you selling?
  audienceDescription: string       // Q2: Who benefits?
  selectedObjective: string         // Q3: What do they do?

  // Business gathering
  repositoryMatches: number         // Count from My Leads search
  selectedBusinessIds: string[]     // Chosen from repository
  newDiscoveryBusinessIds: string[] // From Discover (if any)

  // Workflow
  capacity: number                  // Q4: How many to reach?
  automationLevel: 'manual' | 'personalize' | 'generate' // Q5: Help level

  // UI state
  currentStep: 1 | 2 | 3 | 4 | 5 | 6
  showDiscoverRecommendation: boolean
  showAIRecommendations: boolean
}
```

**Persistence:**
- Session state: React state + sessionStorage (survives page reload)
- No database changes
- Cleared when user leaves Prospecting

---

## Integration Points (No Changes Needed)

**My Leads (repository search):**
- Query: Search My Leads by intent-derived criteria
- Return: Matching business IDs + count
- No My Leads changes; just new search path

**Discover (optional):**
- Entry: `/dashboard/scraper?intent=<intent>&return=prospecting`
- Exit: Automatically return to Prospecting with new businesses
- No Discover changes; just new routing

**Commercial Intelligence (context):**
- Used for audience relevance ranking
- Used for personalization suggestions
- No CI changes; just new consumption

**Message Generation (future):**
- Input: Commercial intent, audience, objective, business context
- Output: Personalized messages
- New feature, separate implementation

---

## Component Specifications

### CommercialIntentQuestion
```typescript
interface CommercialIntentQuestionProps {
  value: string
  onChange: (text: string) => void
  onNext: () => void
}

Renders:
- "What are you selling today?"
- Large text input (150px height)
- Placeholder: "e.g., B2B SaaS accounting software..."
- Next button (enabled when text.length > 10)
- Progress: 1/5
```

### AudienceQuestion
```typescript
interface AudienceQuestionProps {
  value: string
  onChange: (text: string) => void
  onNext: () => void
  onAISuggestions: () => void // Calls AI service
}

Renders:
- "Who is most likely to benefit?"
- Large text input (200px height)
- Expandable "AI Recommendations" button
- (If expanded) AI suggestions for industries, types, profiles
- Next button (enabled when text.length > 10)
- Progress: 2/5
```

### ObjectiveQuestion
```typescript
interface ObjectiveQuestionProps {
  selected: string | null
  onSelect: (objective: string) => void
  onNext: () => void
}

Renders:
- "What would you like them to do?"
- 6 preset option buttons (each with icon)
- Custom option input (if last option selected)
- Next button (enabled when objective selected)
- Progress: 3/5
```

### RepositoryCheckResults
```typescript
interface RepositoryCheckResultsProps {
  intent: CommercialIntent
  matchCount: number
  breakdownWithCI: { withContact: number; withoutContact: number }
  showDiscoverRecommendation: boolean
  onContinue: () => void
  onDiscoverRecommended: () => void
}

Renders:
- Intent summary (what you're selling, who, objective)
- Match count: "X businesses match"
- Breakdown by CI availability
- (If recommended) "Only X matches. Find more?" with suggestions
- Continue or Discover button
```

### CapacityQuestion
```typescript
interface CapacityQuestionProps {
  min: number
  max: number
  default: number
  value: number
  onChange: (num: number) => void
  onNext: () => void
}

Renders:
- "How many businesses would you like to reach today?"
- Number input or slider
- Recommendation: "We suggest starting with 20"
- Next button
- Progress: 4/5
```

### AutomationLadder
```typescript
interface AutomationLadderProps {
  selected: 'manual' | 'personalize' | 'generate' | null
  onSelect: (level: 'manual' | 'personalize' | 'generate') => void
  onContinue: () => void
}

Renders:
- "How would you like to create messages?"
- 3 option cards (each showing example, effort, speed)
- Selection highlight
- Continue button (enabled when selected)
- Progress: 5/5
```

---

## Navigation & Routing

### Prospecting Entry Points

**From Dashboard:**
```
Dashboard → "Start prospecting" button → /dashboard/prospecting
```

**From My Leads:**
```
My Leads → Business selected → "Prospect this business" → /dashboard/prospecting?business_id={id}
(Pre-fills intent and auto-selects business in step 4)
```

**From Discover:**
```
Discover → After discovery → "Continue prospecting" → /dashboard/prospecting?businesses={ids}
(Auto-includes discovered businesses in step 4)
```

### Navigation Within Prospecting

- Previous/Next buttons between steps
- Back button at top (returns to dashboard)
- Progress indicator shows current step
- No skip-ahead (sequential flow by design)

---

## Automation Ladder Outcomes

### Level 1: "I'll write everything myself"
**What happens:**
1. Show selected businesses
2. Editor: "Write your message"
3. ALPA personalizes contact info only (name, company)
4. Review + send

**Implementation:** Message editor component + contact field personalization

### Level 2: "Help me personalize each business"
**What happens:**
1. Show selected businesses
2. Editor: "Write a template"
3. ALPA auto-personalizes using:
   - Company name, industry, size
   - CI insights (if available)
   - Decision maker name (if known)
4. Review per-business messages
5. Send

**Implementation:** Template editor + auto-personalization engine

### Level 3: "Generate everything for me"
**What happens:**
1. ALPA generates personalized messages for each business
2. Uses: commercial intent + audience + objective + business context
3. User reviews all drafts
4. Can edit any before sending
5. Send

**Implementation:** AI message generator (future)

---

## Page Flow Diagram

```
START: /dashboard/prospecting
│
├─ Step 1: CommercialIntentQuestion
│  │ (What are you selling?)
│  └─> Next
│
├─ Step 2: AudienceQuestion
│  │ (Who benefits? With optional AI suggestions)
│  └─> Next
│
├─ Step 3: ObjectiveQuestion
│  │ (What do they do?)
│  └─> Next
│
├─ Step 4: RepositoryCheck & Optional Discovery
│  │ (Search My Leads)
│  │ ├─ If matches sufficient → Next
│  │ └─ If matches insufficient → Discover
│  │     ├─ [Navigate to Scraper with intent]
│  │     ├─ [User discovers businesses]
│  │     └─ [Auto-return to Prospecting with new businesses]
│  └─> Next
│
├─ Step 5: CapacityQuestion
│  │ (How many to reach?)
│  └─> Next
│
├─ Step 6: AutomationLadder
│  │ (What level of help?)
│  └─> Continue
│
└─ END: Message Creation (specific UX depends on selected level)
   └─ Return to Dashboard or start new campaign
```

---

## Implementation Phases

### Phase 1: Core Flow (Week 1)
**Goal:** Three questions → Repository search → Automation selection

**Components to build:**
- CommercialIntentQuestion
- AudienceQuestion
- ObjectiveQuestion
- RepositoryCheckResults
- CapacityQuestion
- AutomationLadder
- ProspectingFlow (state management)

**Backend:** None (uses existing My Leads search)

**Time estimate:** 3-4 days

---

### Phase 2: Discover Integration (Week 2)
**Goal:** Seamless discovery flow from within Prospecting

**Features:**
- Detection: "Only X matches" → Recommend Discover
- AI-generated search suggestions
- Navigate to Discover with intent pre-populated
- Auto-return to Prospecting with new businesses

**Backend:** Query parameter encoding for intent

**Time estimate:** 2 days

---

### Phase 3: AI Enhancements (Week 3+)
**Goal:** AI recommendations + AI message generation

**Features:**
- AI industry/type suggestions for audience
- AI-generated personalization
- AI full message generation (Level 3)
- Learning from user feedback (which messages perform best)

**Backend:** AI service integration

**Time estimate:** Depends on AI model chosen

---

## What Doesn't Change

✅ **My Leads repository stays unchanged**
- Still the business container
- Still shows all discovered businesses
- Still has search, filter, archive functions

✅ **Discover module stays unchanged**
- Still finds new businesses
- Still enriches with contact info
- Still triggers Commercial Intelligence

✅ **Commercial Intelligence stays unchanged**
- Still provides business context
- Still versioned and immutable
- Still available for personalization

✅ **Database schema unchanged**
- No new tables
- No new columns
- No data migrations

✅ **ADRs remain valid**
- ADR-001: My Leads is repository ✓
- ADR-002: Database is source of truth ✓
- ADR-003: CI is versioned enhancement ✓
- ADR-004: Module responsibilities ✓

✅ **Admin-only remains intact**
- Prospecting is admin-only feature
- Preserve existing access controls

---

## UX Principles

1. **Start with intent, not data**
   - User describes what they want to accomplish first
   - ALPA then finds the right data

2. **Respect user agency**
   - Three automation levels respect how users like to work
   - Don't force AI on anyone

3. **Minimize friction**
   - Sequential, simple questions
   - Clear progress indication
   - Easy to understand next step

4. **Intelligent defaults**
   - Capacity default: 20 (reasonable for first campaign)
   - Automation default: "Personalize" (good balance)
   - Can always change

5. **Optional AI, not forced**
   - AI recommendations expandable, not intrusive
   - Each automation level works without AI
   - User always in control

---

## Success Criteria

After implementation, Prospecting should feel like:

✅ "I start with my goal, not my data"  
✅ "ALPA understands what I'm trying to accomplish"  
✅ "It found the right businesses for me"  
✅ "I can control how much help I get"  
✅ "Message creation is natural and flows from my intent"  
✅ "I never feel forced to use AI if I don't want to"  

---

## Open Questions for Approval

Before proceeding to Phase 1, please confirm:

- [ ] Three-question framework feels right?
- [ ] Automation ladder (manual → personalize → generate) appropriate?
- [ ] Discover integration strategy makes sense?
- [ ] Component hierarchy is logical?
- [ ] Phase structure is realistic?

---

**Design Document Complete**

Ready for: component prototyping, Phase 1 implementation kickoff, or clarifications.

