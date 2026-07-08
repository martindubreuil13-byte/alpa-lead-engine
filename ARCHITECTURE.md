# ALPA Product Architecture

**Version:** 2.0 (Next Generation)  
**Principle:** The Business is the permanent object  
**Status:** Design specification (no implementation)

---

## FOUNDATIONAL PRINCIPLE

**The Business is the permanent, immutable center of ALPA.**

A business:
- Is discovered once
- Exists only once (no duplicates, copies, or moves)
- Lives forever in My Leads (unless explicitly archived/deleted)
- Is referenced by all other modules
- Accumulates history over time
- Represents a commercial opportunity that persists across campaigns, conversations, and years

**Corollary:** Every other entity (campaigns, conversations, opportunities, activities) is ephemeral relative to the business. They are operational overlays on the permanent business record.

---

## CORE MODULES

### 1. Dashboard
**Responsibility:** Operational overview  
**Purpose:** At-a-glance status of user's sales pipeline and efforts  
**Contains:** KPIs, recent activity, next actions  
**References:** Businesses, campaigns, conversations, opportunities  
**Does NOT contain:** Detailed business data, editing capabilities, campaign management

**Why separate?** Dashboard is a *view* layer, not a source of truth.

---

### 2. Discover
**Responsibility:** Acquire businesses  
**Purpose:** Find new potential customers  
**Contains:**
- Search/filter interface
- Bulk import (CSV, API, manual)
- AI-generated business discovery
- Source attribution (where each business came from)
- Deduplication checks
- Review before adding to My Leads

**Does NOT contain:**
- Campaign management
- Outreach execution
- Conversation history
- Opportunity tracking
- Enrichment results display (though they are fetched)

**Key design principle:** Discover is a *funnel*, not storage. Businesses flow from Discover → My Leads. Once in My Leads, they are never moved or deleted from Discover.

---

### 3. My Leads
**Responsibility:** Permanent business repository + qualification workspace  
**Purpose:** The commercial memory of ALPA  
**Contains:**
- Complete business records (immutable core data)
- Commercial Intelligence (enriched attributes)
- Qualification state (ready, needs review, waiting for data, etc.)
- Business status (active, archived, not interested, etc.)
- All history (when added, enrichment timeline, past outreach)
- Relationship links (which campaigns touched this business, conversations, opportunities)
- Business notes and tags

**Does NOT contain:**
- Campaign management
- Outreach drafts or execution
- Detailed conversation content (stored separately, referenced)
- Opportunity details (stored separately, referenced)

**Access pattern:** My Leads is the *read-from* source for all other modules. It is the query target.

**Immutability principle:** Core business data (company name, website, location, industry) never changes. CI data is versioned. All changes are logged as activities.

---

### 4. Outreach
**Responsibility:** Campaigns, drafts, execution, communication history  
**Purpose:** Plan and execute targeted business outreach  
**Contains:**
- Campaigns (container for outreach intent)
- Campaign membership (which businesses are in this campaign)
- Outreach templates
- AI-generated drafts (personalized per business)
- Execution state (queued, sent, bounced, replied)
- Communication drafts and final sent content
- Email execution (SMTP, tracking)
- Reply capture and basic response analysis

**Does NOT contain:**
- Business data (references My Leads)
- Detailed conversation analysis (that flows to Pipeline)
- Opportunity qualification (that happens in Pipeline)
- Business enrichment (that happens in Commercial Intelligence)

**Flow:** Campaign → Target businesses (from My Leads) → Generate drafts → Execute → Track replies

---

### 5. Pipeline
**Responsibility:** Opportunities, qualification, deal tracking  
**Purpose:** Move potential customers through sales stages  
**Contains:**
- Opportunities (generated from conversations)
- Opportunity stages (lead, qualified, proposal, negotiation, customer, lost)
- Deal value and forecast
- Win/loss analysis
- Activity timeline per opportunity

**Does NOT contain:**
- Business data
- Campaign details
- Outreach execution
- Communication content (references Outreach)

**Key pattern:** Opportunities are *derived* from conversations. A conversation becomes an opportunity when a business shows intent. The pipeline is built from those opportunities, not created independently.

---

### 6. Future: AI Agents
**Responsibility:** Autonomous actions on businesses  
**Purpose:** Execute activities without user intervention  
**References:** All immutable business data, but requests user approval for material actions  
**Does NOT create duplicates or modify core business data**

Example agents:
- Enrichment agent: Continuously improves CI data
- Outreach agent: Suggests next steps based on conversation history
- Pipeline agent: Identifies opportunities that should move stages
- Research agent: Analyzes competitive landscape

---

## ENTITIES AND RELATIONSHIPS

### Entity: Business
**Immutable core** (discovered once, lives forever)

**Attributes:**
- id (UUID, immutable)
- company_name (immutable)
- website (immutable, key for deduplication)
- location (city, country - immutable)
- industry (immutable)
- created_at (when discovered)
- source (where discovered from: manual, import, search, ai-generated)
- status (active, archived, not_interested, customer)
- qualified_at (when marked ready for outreach)
- qualified_reason (why qualified)

**Immutability principle:** These attributes do NOT change. If a business's real-world data changes, it's a different business.

---

### Entity: Commercial Intelligence
**Enrichment data** (versioned, accumulates over time)

**Attributes:**
- business_id (FK to Business)
- version (timestamp, allows history)
- enrichment_status (pending, processing, completed, failed)
- website_snapshot (archived HTML)
- business_signals (parsed attributes: employee_count, revenue, etc.)
- commercial_profile (AI-generated description)
- topics (semantic keywords)
- capabilities (services offered)
- last_enriched_at
- error_log (if failed)

**Relationship:** Business → has → Commercial Intelligence (one-to-many, immutable records)

**Key principle:** Never overwrite CI data. Append new versions. Users can see enrichment history.

---

### Entity: Campaign
**Outreach container**

**Attributes:**
- id (UUID)
- user_id (FK to User)
- name (e.g., "Q3 SMBs", "Referral Follow-up")
- status (active, paused, completed, archived)
- created_at
- start_date (intended outreach start)
- end_date (intended outreach end)
- target_count (how many businesses to target)
- outreach_template (default template for this campaign)
- purpose (internal note: "expand client base", "cross-sell", etc.)

**Relationship:** Campaign → references → Businesses (through Campaign Membership, not direct)

**Key principle:** Campaign does NOT store business data. It is a container for outreach intent.

---

### Entity: Campaign Membership
**Which businesses are in which campaigns**

**Attributes:**
- id (UUID)
- campaign_id (FK to Campaign)
- business_id (FK to Business)
- added_at (when added to campaign)
- outreach_status (not_started, draft_ready, sent, replied, failed)
- draft_sent (the final draft sent)
- date_sent (when outreach was sent)
- reply_received_at (if replied)

**Relationship:** Campaign ← has many → Campaign Membership ← references many → Business

**Key principle:** Campaign Membership is the join table that enables many-to-many without duplicating business data.

---

### Entity: Conversation
**Communication history**

**Attributes:**
- id (UUID)
- business_id (FK to Business)
- campaign_id (FK to Campaign, nullable - conversation might start outside a campaign)
- started_at (first contact date)
- last_activity_at
- status (active, paused, closed)
- message_count
- tone_detected (interested, neutral, uninterested, objection, etc.)
- next_action_suggested (AI-generated)

**Relationship:** Business → has many → Conversation

**Key principle:** Conversation is the log of engagement with a business. It persists even if outreach campaign ends.

---

### Entity: Opportunity
**Business expressed interest; qualified for pipeline**

**Attributes:**
- id (UUID)
- business_id (FK to Business)
- created_from_conversation_id (FK to Conversation - audit trail)
- created_at (when opportunity identified)
- stage (lead, qualified, proposal, negotiation, customer, lost)
- deal_value (USD)
- probability (0-100)
- expected_close_date
- notes (internal)
- closed_at (if won or lost)
- closed_reason (won, lost_competitor, lost_budget, lost_timing, etc.)

**Relationship:** Business → has many → Opportunity

**Key principle:** Opportunity is a *state change* in the business. It doesn't duplicate data; it layers qualification on top.

---

### Entity: Activity
**Immutable event log** (everything that happens)

**Attributes:**
- id (UUID)
- business_id (FK to Business)
- actor_id (FK to User, nullable if system action)
- action_type (added_to_leads, enrichment_completed, campaign_added, outreach_sent, reply_received, stage_changed, notes_added, etc.)
- timestamp (when it happened)
- context (JSON, flexible)
- metadata (what changed, from/to values)

**Relationship:** Business → has many → Activity (immutable append-only log)

**Key principle:** Activity is the complete audit trail. Nothing is hidden or rewritten. Users can see exactly when and how each business was touched.

---

### Entity: User
**Account and settings**

**Attributes:**
- id (UUID)
- email
- workspace_name
- email_account (for sending outreach)
- api_keys (for integrations)
- settings (UI preferences, notification settings)

**Relationship:** User → has many → Business (ownership, RLS enforced)

**Key principle:** Every business belongs to exactly one user. No shared access (future feature if needed, but not in v1 architecture).

---

## COMPLETE ENTITY DIAGRAM

```
User
  │
  ├─── owns ──→ Business (immutable, permanent)
  │              │
  │              ├─── has ──→ Commercial Intelligence (versioned history)
  │              │
  │              ├─── has ──→ Conversation
  │              │              │
  │              │              └─── references ──→ Campaign
  │              │
  │              ├─── has ──→ Opportunity
  │              │              │
  │              │              └─── created_from ──→ Conversation
  │              │
  │              └─── has ──→ Activity (append-only log)
  │
  ├─── creates ──→ Campaign
  │                  │
  │                  └─── has_many ──→ Campaign Membership
  │                                      │
  │                                      └─── references ──→ Business
  │
  └─── sends ──→ Outreach (part of Campaign Membership state)
```

**Key observation:** There are NO circular references. Everything flows from Business.

---

## USER WORKFLOW: FREELANCER ACQUIRING CLIENTS

**Goal:** Find new clients and send targeted outreach  
**Time allocation:** 80% discovery & qualification, 10% outreach execution, 10% pipeline

### Step 1: Open ALPA (Dashboard)
**What they see:**
- "You have 245 active leads"
- "Last week: 12 emails sent, 3 replied"
- "Pipeline: 2 proposals, 1 negotiation"
- Suggested next actions

**Time spent:** 30 seconds

**Decision point:** What do I need to do today?

---

### Step 2: Need New Leads → Go to Discover
**What happens:**
1. Search for businesses matching criteria (industry, size, location)
   - OR import CSV of prospects
   - OR request AI to generate list of similar businesses

2. Review results
   - Business name, website, location
   - CI data if available (not all will be enriched yet)
   - Source attribution

3. Deduplication check
   - "This looks like the same company as XYZ in My Leads. Merge?"
   - Prevents duplicates from the start

4. Select businesses to add
   - Bulk add to My Leads
   - OR preview first by clicking into each

5. Add to My Leads
   - Businesses are now in repository
   - CI enrichment is queued
   - Status: "needs_review" (not yet qualified)

**Time spent:** 20-30 minutes

**Decision point:** Which businesses look promising?

**Output:** 10-20 new businesses in My Leads

---

### Step 3: Qualify in My Leads
**What happens:**
1. Open My Leads
2. Filter to "needs_review" (new businesses)
3. For each business:
   - Read summary (from CI)
   - Review enrichment data (industry, size, services)
   - Check if CI is complete
   - Decide: ready for outreach, or needs more research?
   - Add tags (size, budget_fit, timeline, etc.)
   - Add notes ("CEO is in my network", "Saw them at conference", etc.)

4. Mark as "ready" or "waiting_for_data"

**Time spent:** 15-25 minutes

**Decision point:** Does this business match our ICP?

**Output:** 3-5 qualified businesses ready for outreach

---

### Step 4: Create Campaign
**What happens:**
1. Go to Outreach
2. Create new campaign (or select existing one)
   - Name: "Q3 SMB Outreach"
   - Template: Select email template to use
   - Purpose: "Expand SMB client base"

3. Add businesses to campaign
   - Search My Leads
   - Bulk add 5 qualified businesses
   - Campaign now contains these businesses (via Campaign Membership)

**Time spent:** 5 minutes

**Decision point:** What's the message we want to send?

---

### Step 5: Generate and Personalize Drafts
**What happens:**
1. Campaign screen shows all businesses
2. For each business:
   - ALPA generates draft email using template + CI data
   - Draft is personalized (company name, industry insights, etc.)
   - User can edit draft
   - Preview looks good?
   - Mark "ready to send"

3. Schedule send (immediate or scheduled)

**Time spent:** 10 minutes (1-2 min per business)

**Decision point:** Does this message sound authentic?

**Output:** 5 personalized email drafts ready to send

---

### Step 6: Send Outreach
**What happens:**
1. ALPA sends emails (via user's email account)
2. Tracking links capture:
   - Email delivered
   - Link clicks (if any)
   - Reply received

3. Campaign Membership updates:
   - outreach_status → "sent"
   - date_sent → timestamp
   - reply_received_at → when reply comes in

4. Activity log records the send for each business

**Time spent:** 1 minute (automated)

**Output:** 5 emails sent, tracking active

---

### Step 7: Monitor Replies (Passive)
**What happens:**
1. User continues working
2. Replies arrive
3. ALPA detects replies and logs them
4. Dashboard shows "3 new replies"
5. User clicks on notification to see them

**When user reads reply:**
1. Conversation view appears
   - Entire history with this business
   - Original outreach shown
   - Reply shown
   - Tone detected (interested, neutral, etc.)

2. User decides:
   - Reply personally
   - OR create Opportunity (move to Pipeline)
   - OR add note and follow up later

3. If Opportunity created:
   - Business moves from "prospect" to "pipeline"
   - Opportunity record created with stage "lead"
   - Activity logged

**Time spent:** 2-5 minutes per reply

---

### Step 8: Pipeline Management
**What happens:**
1. Go to Pipeline
2. See all Opportunities by stage
3. See one from recent outreach in "lead" stage
4. Decide if it's qualified enough to move to "qualified"
5. Move it (drag or click)
6. Activity logged

**Time spent:** 1 minute per opportunity

---

### Complete Workflow Summary

```
Discover (30 min)
  ↓
  10-20 new businesses in My Leads
  ↓
My Leads - Qualify (20 min)
  ↓
  3-5 businesses marked ready
  ↓
Outreach - Campaign (5 min)
  ↓
  Create campaign, add businesses
  ↓
Outreach - Drafts (10 min)
  ↓
  Personalize messages
  ↓
Outreach - Send (1 min)
  ↓
  Emails tracked
  ↓
Passive: Monitor replies
  ↓
Read reply → Create Opportunity
  ↓
Pipeline - Manage (1 min)
  ↓
Move stages as deals progress
```

**Total time: ~70 minutes per cycle**

**Where they spend 80% of time:**
- Discovering new businesses (Discover)
- Qualifying businesses (My Leads)
- Reviewing enrichment quality (My Leads)
- Personalizing outreach (Outreach)

**Where they spend 10%:**
- Campaign management (Outreach)

**Where they spend 10%:**
- Pipeline moves (Pipeline)

---

## IMMUTABILITY AND CHANGE TRACKING

### What is Immutable
- Business core data (company name, website, location, industry)
- Conversation history (what was said, when)
- Sent outreach content (what was actually sent)
- Opportunity creation (when it was created, why)
- Activity log (complete audit trail)

### What Changes
- Business status (active → archived, active → customer)
- Business qualification state (needs_review → ready)
- Opportunity stage (lead → qualified → proposal)
- Opportunity deal value (estimate changes)
- Campaign status (active → completed)
- Conversation status (active → closed)

### Change Tracking Pattern
Every change creates an Activity record:
```
Activity {
  business_id: UUID,
  action_type: "stage_changed",
  timestamp: NOW(),
  metadata: {
    from: "lead",
    to: "qualified"
  }
}
```

### No Overwrites
When business data needs updating:
1. If it's core data that shouldn't change: flag as inconsistency, don't change
2. If it's enrichment data: append new version with timestamp
3. If it's state (status, stage): update and log in Activity
4. If it's temporary data (notes, tags): update freely

---

## BUSINESS DEDUPLICATION

**Problem:** Multiple sources bring in the same business (search result + CSV import + AI suggestions)

**Solution: Multi-stage deduplication**

### Stage 1: Discover (before adding to My Leads)
When user tries to add a business, check:
- Does My Leads already have a business with this website?
- Does My Leads have a business with similar name + location?

If match found: "This looks like [existing business]. Are you sure this is different?"

User can:
- Skip (don't add duplicate)
- Confirm it's different (same name, different location/website)
- Merge (link to existing business, add new attributes)

### Stage 2: My Leads (retrospective)
Periodic background check:
- Find potential duplicates (same website, very similar name)
- Flag for user review
- User approves merge

### Stage 3: Incoming sources
Every time a business is discovered via API/import/search:
- Compute fingerprint (website domain + location)
- Check if exists
- If exists, link to existing record
- Add new source attribution

---

## AVOIDING DUPLICATION THROUGHOUT THE SYSTEM

### Campaign Membership
One business can be in multiple campaigns. No duplication.
- Business X in Campaign A: outreach_status = sent
- Same Business X in Campaign B: outreach_status = draft_ready
- No duplicate business records created

### Conversations
One business can have multiple conversations.
- Conversation from Campaign A
- Conversation from direct inbound
- Both reference same business record

### Opportunities
One business can have multiple opportunities over time.
- Opportunity 1: Q2 2024, lost_competitor
- Opportunity 2: Q3 2024, in negotiation
- Both reference same business record

**Key insight:** The business is constant. Everything else is operational overlays.

---

## OPERATIONAL VIEWS (MODULES ARE VIEWS, NOT SOURCES OF TRUTH)

### Dashboard View
Aggregation of:
- Count of businesses in each status
- Recent activity (from Activity log)
- Reply volume (from Conversation)
- Pipeline summary (from Opportunity)

**Source of truth:** Business, Activity, Conversation, Opportunity

---

### Discover View
Filter over:
- All businesses not yet in My Leads
- OR all businesses in My Leads (for re-engaging)

**Source of truth:** Business

---

### My Leads View
Filter and sort:
- All businesses owned by user
- With enrichment status
- With activity history
- With incoming conversations

**Source of truth:** Business, Commercial Intelligence, Activity, Conversation

---

### Outreach View
Query:
- All campaigns
- Campaign memberships with status
- Conversation history per business
- Draft state

**Source of truth:** Campaign, Campaign Membership, Conversation

---

### Pipeline View
Query:
- All opportunities by stage
- Deal value per opportunity
- Recent activity per opportunity

**Source of truth:** Opportunity, Activity

---

## ARCHITECTURE CHALLENGES AND SOLUTIONS

### Challenge 1: Users accidentally archiving the wrong business
**Solution:** Soft delete + undo window
- Archive sets status to 'archived' (not deleted)
- Activity records the archive
- User can restore within 30 days
- After 30 days, truly deleted from search/view but data retained

---

### Challenge 2: Business data becomes stale
**Solution:** Versioned enrichment + user refresh
- CI data is versioned with timestamp
- User can manually trigger re-enrichment
- AI agent can auto-enrich periodically (future feature)
- All versions retained for history

---

### Challenge 3: Confusion about which campaign a reply came from
**Solution:** Complete conversation history
- Conversation shows all campaigns that touched this business
- Each outreach clearly linked to campaign
- Reply is attributed to the campaign it came from
- User can see "sent in Campaign A, replied Oct 15"

---

### Challenge 4: User creates 10 campaigns that all target the same 100 businesses
**Solution:** Campaign Membership allows this intentionally
- Same business in Campaign A (Q3 SMBs)
- Same business in Campaign B (Referral follow-up)
- Different outreach status in each
- Both are valid operational views
- User sees clearly what happened with each

---

### Challenge 5: Pipeline shows opportunity worth $50k, but is it real?
**Solution:** Conversation history + activity log
- Click opportunity → see the conversation that created it
- See all replies from that business
- See activity history of the deal
- User judgment: is this real?

---

### Challenge 6: At 1M businesses, queries become slow
**Solution:** Composite indexes on read-heavy queries
```
Business
  - (user_id, status) for My Leads view
  - (user_id, qualified_at) for ready leads
  - (user_id, created_at) for activity view

Campaign Membership
  - (campaign_id, business_id) for campaign view
  - (business_id, added_at) for business view

Opportunity
  - (business_id, stage) for pipeline
  - (user_id, stage) for dashboard
  - (business_id, created_at) for history

Activity
  - (business_id, timestamp) for lead history
  - (user_id, timestamp) for user feed
```

With proper indexes, all queries remain sub-100ms at 1M businesses.

---

### Challenge 7: Future AI agents need to take actions without duplicating data
**Solution:** Agents write to the same entities, not parallel systems
- Enrichment agent: updates Campaign Intelligence (versioned)
- Outreach agent: suggests reply (comment, not separate entity)
- Pipeline agent: suggests stage move (logged as activity if accepted)
- All agent actions create audit trail in Activity

No agent creates duplicate business records or parallel data structures.

---

## SCALABILITY ANALYSIS

### At 100 businesses (freelancer starting)
- Simple queries work fine
- No performance issues
- No deduplication challenges yet

### At 1,000 businesses (growing freelancer)
- Search needs index on (user_id, status, created_at)
- Activity log is growing but manageable
- Deduplication rarely triggered

### At 10,000 businesses (agency)
- Multiple users? (future feature)
- Bulk operations become valuable
- Reporting becomes important
- Still single-user, single-workspace

### At 1,000,000 businesses (ALPA platform with many users)
- Composite indexes required
- Partitioning may be needed (by user_id, by created_at)
- Caching layer valuable (Redis for recent activity)
- Background processes for deduplication, enrichment
- Separate read replicas for reporting

**Architecture doesn't break. It just needs optimization, not redesign.**

---

## WHAT THIS ARCHITECTURE PREVENTS

### ✅ Prevents: Duplicate businesses
Multiple discovery paths → single business record

### ✅ Prevents: Inconsistent data
Business record is immutable core. All changes tracked.

### ✅ Prevents: Lost history
Activity log is append-only. Nothing is hidden or rewritten.

### ✅ Prevents: Confused users
Clear ownership (business → campaign → outreach → conversation → opportunity)

### ✅ Prevents: Scaling problems
Composite indexes, versioning, and immutability make scaling straightforward.

### ✅ Prevents: AI agent conflicts
Agents write to shared entities. No parallel data structures.

---

## WHAT THIS ARCHITECTURE ENABLES

### ✅ Enables: Focus on discovery and qualification
80% of time in My Leads and Discover. That's where value is.

### ✅ Enables: Flexible outreach
Same business in multiple campaigns with different messaging.

### ✅ Enables: Rich conversation history
Complete audit trail of every touch.

### ✅ Enables: Future AI agents
Agents enhance existing entities, don't duplicate them.

### ✅ Enables: Reporting and analytics
Every action is logged. Easy to analyze "which campaigns convert?"

### ✅ Enables: Long-term relationships
Business lives forever. User can re-engage any time.

### ✅ Enables: Team features (future)
With user_id on Business, can eventually allow shared access without data duplication.

---

## IMPLEMENTATION NOTES (NOT YET)

This architecture is database-agnostic. Could be implemented in:
- PostgreSQL (recommended: structured, ACID, great for audit logs)
- MongoDB (possible: would need careful design to prevent duplicates)
- DynamoDB (possible: would be expensive and complex)

**Recommended: PostgreSQL**
- ACID guarantees prevent race conditions
- Composite indexes efficient
- JSON columns support enrichment versioning
- Append-only Activity table is natural

---

## DECISION POINTS FOR NEXT PHASE

1. **Multi-user/team support:** Included in architecture? (yes, with user_id) Or v2 feature? (recommended v2)

2. **Shared access:** Can teams see the same business? (recommend: no in v1, single-user workspaces)

3. **Business history visibility:** Can user see "this business was in Campaign A in June"? (yes, via Activity)

4. **Soft vs hard deletes:** Archive or permanently delete businesses? (recommend: soft delete, 30-day undo)

5. **Conversation capture:** Auto-capture inbound emails? (recommend: v1 is manual, v2 adds email integration)

6. **Opportunity auto-create:** Should replying = auto-create opportunity? (recommend: manual, user decides)

---

## SUMMARY

This architecture:
- ✅ Makes Business the permanent center
- ✅ Prevents duplicates at source
- ✅ Tracks all changes immutably
- ✅ Enables multiple operational views without duplication
- ✅ Scales from 100 to 1M businesses without redesign
- ✅ Supports future AI agents and team features
- ✅ Keeps users focused on high-value activities (discovery, qualification)
- ✅ Maintains complete audit trail of every business interaction

**Result:** A system that feels elegant at any scale, with a business as the permanent, immutable, accountable center.
