# Prospecting Workspace: Architecture Alignment

**Purpose:** Confirm that the new Prospecting design integrates cleanly with existing architecture (ADR-001 through ADR-004)

**Date:** 2026-07-08

---

## Alignment with ADRs

### ✅ ADR-001: My Leads is the Permanent Business Repository

**How Prospecting respects this:**

```
Prospecting workflow:
1. User defines intent (what, who, objective)
2. Intent → My Leads search criteria
3. Query My Leads repository
4. Show businesses from repository that match
5. User optionally discovers new businesses (added to My Leads)
6. Return to Prospecting with businesses from repository

Result: All businesses come from My Leads; Prospecting references, doesn't own.
```

**No violation of ADR-001:**
- Prospecting never creates businesses (only discovery creates)
- Prospecting never deletes or modifies business records
- Prospecting queries My Leads without ownership
- Prospecting is just another module referencing the repository

---

### ✅ ADR-002: Database is the Single Source of Truth

**How Prospecting respects this:**

```
Prospecting state:
- Commercial intent (session memory): Q1, Q2, Q3 answers
- Business selection (from database): IDs from My Leads
- Workflow state (session memory): capacity, automation level
- Message drafts (database, outreach_queue table): stored when ready

No dual state:
- All persistent data lives in database
- Session state is ephemeral (cleared when user leaves Prospecting)
- Messages only persisted when moved to outreach queue
```

**No violation of ADR-002:**
- Session state is intentionally temporary
- Real business data always comes from database
- No client-side caching of business records
- No parallel state model

---

### ✅ ADR-003: Commercial Intelligence Architecture

**How Prospecting uses CI (without violating it):**

```
Prospecting consumption of CI:

1. Audience Ranking: My Leads search results ranked by CI relevance
   - Questions: "Who benefits?" → Commercial Intelligence insights → Rank matches
   - Example: User says "Marketing directors" → CI profile shows "marketing_department: true"
   - CI data makes search results more relevant, not stored separately

2. Personalization Hints: Automation Level 2 uses CI for templates
   - User template: "Hi [name], we help [industry] solve [problem]"
   - ALPA personalization: Fill blanks using CI (industry, primary_service, target_customer)
   - CI data used for context, not stored as campaign property

3. Full Generation: Automation Level 3 uses CI + intent for message generation
   - Input: Commercial intent + audience + objective + CI profile
   - Output: Personalized message per business
   - CI data consumed, not modified

No violation of ADR-003:**
- CI results remain immutable in database
- Prospecting reads but never writes to CI data
- No duplicated CI state in Prospecting
- CI versioning stays intact
```

---

### ✅ ADR-004: Module Responsibility Principle

**How Prospecting fits the responsibility model:**

```
Module responsibilities (from ADR-004):

Dashboard:     Overview + next action
Discover:      Find + create businesses
My Leads:      Manage all businesses
Prospecting:   Reference businesses for outreach (NEW)
Outreach Q:    Store drafts + approval workflow
Pipeline:      Track outcomes

Prospecting responsibility:
├─ NOT: Create businesses (Discover does this)
├─ NOT: Manage businesses (My Leads does this)
├─ NOT: Send messages (Outreach does this)
├─ NOT: Track outcomes (Pipeline does this)
│
└─ YES: Reference businesses from My Leads
       Based on commercial intent
       Prepare for outreach
```

**How Prospecting interacts with other modules:**

```
Discover → My Leads → Prospecting → Outreach Queue → Send/Track
                         │
                         └─→ (Optional) Ask user to discover more

Prospecting never modifies:
- Business records (My Leads only)
- CI results (immutable)
- Pipeline stages (Pipeline module)
- Message queue (Outreach Queue)

Prospecting only:
- Reads from My Leads
- Reads from CI (for context)
- Creates session intent
- Routes to other modules
```

**No violation of ADR-004:**
- Clear, singular responsibility: facilitate discovery-to-outreach workflow
- Doesn't duplicate any other module's work
- Respects boundaries
- Enables other modules to work independently

---

## Architectural Layers

```
USER LAYER
├─ What are you selling?
├─ Who benefits?
└─ What do they do?
        ↓ (Intent)

LOGIC LAYER
├─ Parse intent → search criteria
├─ Query My Leads
├─ Evaluate: enough businesses?
├─ If not: recommend Discover
└─ Selected automation level → message strategy
        ↓ (Prepared Intent)

DATA LAYER
├─ My Leads (repository of businesses)
├─ Commercial Intelligence (enhancement on businesses)
├─ Outreach Queue (message storage)
└─ Database (single source of truth per ADR-002)

MODULE LAYER (Prospecting coordinates)
├─ Discover (optional: find more businesses)
├─ Outreach Queue (next step: store drafts)
└─ My Leads (always: select from repository)
```

**Clean separation:**
- User layer: intent questions (Prospecting only)
- Logic layer: intent processing (Prospecting only)
- Data layer: shared, immutable database (all modules)
- Module layer: coordinated interaction (Prospecting orchestrates, doesn't own)

---

## Data Ownership Matrix

```
                My Leads  Discover  Prospecting  Outreach  Pipeline
────────────────────────────────────────────────────────────────────
Businesses        Own      Create      Read        Read      Read
CI Results        Own       Create      Read       (via ML)   (via ML)
Messages          Read       -           -         Own       Read
Pipeline Stages   Read       -           -          -        Own
Intent/Audience   -          -          Own         -         -
Drafts            -          -          -          Own        -
Outcomes          -          -          -          Read      Own
```

**Prospecting owns only:**
- Commercial intent (session-based, not persisted)
- Audience definition (session-based)
- Automation level selection (session-based)

**Prospecting reads (but never writes):**
- Businesses from My Leads
- CI data for personalization context
- Draft templates

---

## Message Flow: Intent to Outreach

```
Prospecting                    My Leads          Commercial         Outreach
                              Repository        Intelligence       Queue
                              
1. User inputs intent
   └─→ What, Who, Objective
   
2. ALPA parses intent
   └─→ Search criteria
   
3. Search My Leads ────────→ Query businesses
                              filtered by criteria
                              
4. Rank results ────────────────────────→ Get CI scores for relevance
                                          (helps rank best matches)
   
5. Show matches
   "47 businesses match"
   
6. User selects automation level
   ├─ Manual: I write
   ├─ Personalize: You help
   └─ Generate: You create
   
7. Prepare messages
   ├─ Template + intent + CI context
   └─ Personalize per business
   
8. Move to drafts ──────────────────────────────→ Store in outreach_queue
                                                   (ready for review/send)
   
9. User reviews
   └─→ (Outreach module handles)
   
10. Send ────────────────────────────────────────→ Send + track
    └─→ (Pipeline module tracks outcomes)
```

**No circular dependencies:**
- Prospecting → My Leads (read)
- Prospecting → CI (read)
- Prospecting → Outreach (write drafts)
- All one-directional

---

## Session State: Intentionally Ephemeral

Why Prospecting doesn't persist its state:

```
Reasoning:
┌─────────────────────────────────────────────┐
│ Prospecting is a WORKFLOW, not a container  │
│                                              │
│ Intent (what, who, objective) is transient  │
│ It guides work, but doesn't need storage    │
│                                              │
│ Once drafts are created, they move to:      │
│ ├─ Outreach Queue (actual storage)          │
│ └─ Database (source of truth)               │
│                                              │
│ Prospecting state is SESSION memory:        │
│ ├─ Survives page reload (sessionStorage)    │
│ └─ Cleared on logout or new session         │
└─────────────────────────────────────────────┘

This is clean because:
- No new database complexity
- No duplicate "prospecting" table
- No state divergence issues
- Respects ADR-002 (DB is authoritative)
```

---

## Discover Integration Without Modification

**How Prospecting uses Discover without changing it:**

```
Current Discover:
- Search by query/location/criteria
- Save results to My Leads
- Trigger Commercial Intelligence
- Return to dashboard

New Discover entry point (with params):
/dashboard/scraper?
  intent=encoded-intent&
  return=prospecting&
  auto-suggestions=true

Discover behavior:
- Same UI, same functionality
- Auto-populate search suggestions based on intent
- After discovery, user clicks "Continue Prospecting"
- Redirects to /dashboard/prospecting?businesses={ids}
- Prospecting auto-includes those businesses

Discover doesn't need modification:
- Query params are read by Discover
- Return URL is optional (Discover already has dashboard redirect)
- All logic stays in Discover
```

---

## Admin-Only Preserved

**Prospecting access control:**

```
Is user admin? (check auth.isAdmin())
├─ YES → Show Prospecting workspace
└─ NO  → Feature locked: "Upgrade your plan"
         (same pattern as Pipeline, Outreach Queue)

No changes to access layer:
- Uses existing auth/access patterns
- Respects existing admin-only gates
- Consistent with other admin modules
```

---

## No Database Changes Required

**Prospecting works with existing schema:**

```
Queries:
├─ Search My Leads: SELECT * FROM leads WHERE (criteria)
├─ Get CI context: SELECT * FROM leads WHERE CI profile matches
└─ Create drafts: INSERT INTO outreach_queue

No new tables:
- No "prospecting_sessions" table
- No "prospecting_intent" table
- No "prospecting_drafts" table
- Everything uses existing tables

Schema stays the same:
- leads (business repository)
- commercial_intelligence (enrichment)
- outreach_queue (message drafts)
- pipeline (outcomes)
```

---

## Backward Compatibility

**Existing paths still work:**

```
My Leads → Select business → "Start outreach"
  ├─ Old path: Route to Outreach Queue with business_id param
  └─ New path: Route to Prospecting with business_id pre-selected
              (skips questions, shows automation ladder)

Dashboard → "Start prospecting"
  └─ New path: Route to Prospecting fresh

Discover → "Continue prospecting"
  └─ New path: Route to Prospecting with businesses pre-selected
```

**No breaking changes:**
- Old flows still work
- New flows layer on top
- Existing campaigns/messages unaffected

---

## ADR Preservation Checklist

- [x] ADR-001: My Leads repository principle respected (Prospecting queries, never owns)
- [x] ADR-002: Database is authoritative (session state is ephemeral)
- [x] ADR-003: CI versioning and immutability respected (read-only, never modify)
- [x] ADR-004: Module boundaries clear (Prospecting has singular responsibility)
- [x] Admin-only preserved (uses existing access control)
- [x] No database schema changes (works with existing tables)
- [x] No My Leads changes (only queries)
- [x] No Discover changes (only new routing option)
- [x] No CI changes (only read consumption)
- [x] Backward compatible (existing flows preserved)

---

## Summary: Why This Design Works

**Architectural Fit:**
1. Prospecting adds user-facing workflow, not system complexity
2. All data stays in My Leads; Prospecting is just a UI lens
3. Session state is temporary; persistent data unchanged
4. No circular dependencies; clean module interaction
5. Respects all existing ADRs without modifications

**Scalability:**
1. Foundation (My Leads, CI) doesn't change
2. Can add AI enhancements without breaking structure
3. Can add new channels (SMS, LinkedIn) without restructuring
4. Can add collaboration features on top

**Maintainability:**
1. Clear boundaries between modules
2. Session state is intentionally ephemeral
3. Easy to test each phase independently
4. Easy to debug (no hidden state)

**User Experience:**
1. Starts with user intent, not system architecture
2. Respects existing module strengths (My Leads, Discover)
3. Progressive automation without forcing AI
4. Natural flow to outreach

---

**Prospecting design is architecturally sound and preserves all foundational principles.**

Ready to proceed to Phase 1 implementation or discuss modifications.

