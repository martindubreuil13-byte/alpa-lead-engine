# ALPA Implementation Blueprint

**Status:** Architectural Design (No Implementation)  
**Foundational Principle:** The Business is the permanent object  
**Mission:** Help businesses discover prospects, understand them, and start conversations that become customers

---

## 1. CURRENT STATE AUDIT

### 1.1 Current Database Structure

**Core Product Tables:**
- `leads` — businesses (called "leads" historically, should be "businesses")
- `pipeline` — opportunities/stages
- `outreach_queue` — email drafts and sending state
- `templates` — email templates
- `commercial_intelligence_queue` — enrichment work queue
- `commercial_intelligence` (implied) — enrichment results

**Agent/Automation Tables:**
- `agent_missions` — AI campaign definitions
- `agent_mission_runs` — AI execution history
- `agent_mission_icps` — AI target lists
- `agent_icp` — AI ideal customer profile
- `agent_lead_queue` — AI workqueue

**Admin/Settings Tables:**
- `activity_logs` — event log
- `follow_up_settings` — follow-up rules
- `lead_follow_ups` — follow-up queue
- `pipeline_automation_settings` — automation config

**Infrastructure Tables:**
- `users` — accounts
- `profiles` — user metadata
- `email_usage` — email tracking
- `usage` — analytics
- `search_analytics` — search behavior

### 1.2 Current State Analysis

**Strengths:**
- ✅ `leads` table is immutable core (businesses don't move between modules)
- ✅ Separate `commercial_intelligence_queue` for enrichment (not embedded)
- ✅ RLS policies prevent cross-user data access
- ✅ `activity_logs` exists for audit trail
- ✅ Separate `outreach_queue` for email execution
- ✅ `pipeline` table for opportunity tracking

**Weaknesses:**
- ❌ "leads" is conceptually wrong (they are businesses, not leads)
- ❌ Agent subsystem is large and coupled to core product
- ❌ Agent tables mix AI-specific logic with core data
- ❌ Enrichment results location unclear (commercial_intelligence table mentioned but not defined)
- ❌ No versioning for enrichment data (CI results overwrite)
- ❌ No explicit `Campaign` entity (part of agent_missions?)
- ❌ No explicit `Conversation` entity (where do emails/replies live?)
- ❌ No explicit `Campaign Membership` (how do we know which businesses are in which campaigns?)
- ❌ Activity log exists but not comprehensively used
- ❌ Multiple state machines (pipeline_stage, agent_mission_runs, outreach_queue status)

**Technical Debt:**
- `agent_*` tables represent a substantial feature subsystem that makes the core product harder to reason about
- Enrichment workflow is split between `commercial_intelligence_queue` (process) and unknown results table
- Email workflow is in `outreach_queue` but unclear how it relates to conversations
- No clear separation: which parts are core product, which are agent, which are automation

**User Friction:**
- Module boundaries are blurred (agent_missions look like campaigns but are something else)
- Unclear how campaigns work (if they do)
- Unclear how conversations are tracked
- Unclear how email state flows from draft → sent → reply

### 1.3 Current Module Organization

**Dashboard** — operational overview (based on code locations)
- Reads from: `leads`, `pipeline`, `outreach_queue`, `email_usage`
- Actions: view-only

**My Leads** — business repository (based on `app/dashboard/my-leads/`)
- Reads/writes: `leads`, `commercial_intelligence_queue`
- Actions: archive, restore, delete, tag, enrich

**Outreach** (if it exists separately)
- Reads/writes: `outreach_queue`, `templates`
- Actions: create draft, send email, track

**Pipeline** (if it exists separately)
- Reads/writes: `pipeline`
- Actions: move stage, estimate value

**Agent** — automation engine
- Reads/writes: `agent_missions`, `agent_mission_runs`, `agent_icp`, `agent_lead_queue`
- Actions: create campaign, execute, generate drafts, analyze

**Admin** — backend operations
- Reads/writes: all tables, especially `activity_logs`, settings tables

### 1.4 Database Schema Observations

**Missing Definitions:**
- No explicit `Campaign` table (or is it `agent_missions`?)
- No explicit `Campaign Membership` table
- No explicit `Conversation` table
- No explicit `Opportunity` table (or is it `pipeline`?)
- No explicit `Commercial Intelligence` table (results location)
- No explicit `Activity` table (have `activity_logs` but underutilized)

**Overlapping Concerns:**
- `pipeline` might represent opportunities, but unclear if it's per-business or per-campaign
- `agent_mission_runs` represent campaign executions, but separate from core outreach
- `outreach_queue` represents email execution, but relationship to `agent_mission_runs` unclear

**State Machine Fragmentation:**
- `leads.pipeline_stage` (closed, active?)
- `agent_mission_runs.status` (running, completed, etc.)
- `outreach_queue.status` (drafted, queued, sent, etc.)

---

## 2. TARGET PRODUCT ARCHITECTURE

### 2.1 Core Entities

#### Business
**Purpose:** The permanent, immutable center  
**Identity:** One record per unique company  
**Attributes (Immutable):**
- `id` (UUID)
- `user_id` (FK to user)
- `company_name`
- `website` (unique key for deduplication)
- `location` (city, country)
- `discovered_at` (when added to My Leads)

**Attributes (Mutable):**
- `industry`
- `positioning`
- `services_description`
- `status` (active, archived, customer, not_interested)
- `qualified_at`
- `tags` (array of strings)
- `notes` (user-added context)
- `last_activity_at` (denormalized for sorting)

**Why separate entity?**
- It's the permanent object everything references
- Must survive campaigns, conversations, and years of history
- Deduplication is critical (prevent business records)

**What does NOT belong:**
- Campaign state (not "in campaign A" — that's Campaign Membership)
- Conversation content (belongs in Conversation entity)
- Opportunity details (belongs in Opportunity entity)
- Enrichment results (belongs in Commercial Intelligence Snapshot)
- Email history (belongs in Conversation)

---

#### Commercial Intelligence
**Purpose:** Versioned enrichment data  
**Key insight:** Enrichment results should NOT overwrite. They should version over time.

**Attributes:**
- `id` (UUID)
- `business_id` (FK to Business, not unique — can have many)
- `version` (integer, auto-incrementing, or timestamp)
- `created_at` (when enrichment completed)
- `enrichment_status` (pending, processing, completed, failed)
- `enrichment_error` (if failed)
- `website_snapshot` (archived HTML/parsed data)
- `business_signals` (structured data: employee_count, revenue_range, etc.)
- `commercial_profile` (AI-generated summary)
- `topics` (array of keywords)
- `capabilities` (array of services)

**Why separate entity?**
- Enrichment is a process that produces versioned results
- Business attributes (industry, services) evolve; CI snapshots show a point-in-time view
- Preserving history allows "what did we know about this business on date X?"
- CI is heavyweight (100s of KB per record); shouldn't bloat Business record

**Relationship:**
- Business → has many → Commercial Intelligence (one-to-many)
- New enrichment appends a row, doesn't overwrite
- Dashboard queries: `WHERE version = (SELECT MAX(version) FROM ci WHERE business_id = X)`

---

#### Campaign
**Purpose:** Container for targeted outreach intent  

**Attributes:**
- `id` (UUID)
- `user_id` (FK to user)
- `name` (e.g., "Q3 SMB Outreach")
- `status` (active, paused, completed, archived)
- `created_at`
- `purpose` (internal note)
- `template_id` (FK to email template)
- `created_at`
- `started_at`
- `ended_at`

**Why separate entity?**
- Campaign is an operational container for outreach intent
- Same business can be in multiple campaigns with different messaging
- Campaign exists independently of which businesses are in it

**What does NOT belong:**
- Business data (reference via Campaign Membership)
- Email drafts or execution state (reference via Conversation)
- AI/automation state (separate agent entities if needed)

---

#### Campaign Membership
**Purpose:** Which businesses are in which campaigns  

**Attributes:**
- `id` (UUID)
- `campaign_id` (FK to Campaign)
- `business_id` (FK to Business)
- `added_at`
- `outreach_status` (not_started, drafted, sent, replied, failed)
- `draft_sent` (the actual email content sent)
- `date_sent`
- `reply_received_at`

**Why separate entity?**
- Enables many-to-many without duplicating business
- Each membership is a distinct "thread" of communication
- Same business in multiple campaigns has distinct membership records

**Relationship:**
- Campaign → has many → Campaign Membership → references many → Business
- This join table is the permutation layer

---

#### Conversation
**Purpose:** Communication history with a business  

**Attributes:**
- `id` (UUID)
- `business_id` (FK to Business)
- `campaign_id` (FK to Campaign, nullable — conversation might start outside a campaign)
- `campaign_membership_id` (FK to Campaign Membership, nullable)
- `created_at`
- `last_activity_at`
- `status` (active, paused, closed)
- `message_count`
- `tone` (interested, neutral, uninterested, objection)
- `next_action_suggested` (AI-generated, optional)

**Why separate entity?**
- Complete audit trail of all engagement with a business
- Persists even when campaign ends
- Foundation for creating opportunities

**What does NOT belong:**
- Email content (belongs in Message/Email entity - child of Conversation)
- Opportunity details (those link back to Conversation, not embedded)

**Child entity:** Message
- `id` (UUID)
- `conversation_id` (FK to Conversation)
- `message_type` (outbound_email, inbound_reply, note, etc.)
- `sender` (user_id or system)
- `recipient`
- `content`
- `created_at`
- `metadata` (email open, link click, etc.)

---

#### Opportunity
**Purpose:** Business expressed interest; qualified for pipeline  

**Attributes:**
- `id` (UUID)
- `business_id` (FK to Business)
- `conversation_id` (FK to Conversation — audit trail: why this opportunity was created)
- `created_from_message_id` (FK to specific Message, optional — even more precise)
- `created_at`
- `stage` (lead, qualified, proposal, negotiation, customer, lost)
- `deal_value` (USD, optional)
- `probability` (0-100)
- `expected_close_date`
- `closed_at` (when won or lost)
- `closed_reason` (won, lost_competitor, lost_budget, lost_timing, lost_no_response)
- `notes`

**Why separate entity?**
- Opportunity is a lens on a business (not a duplicate)
- One business can have multiple opportunities over time
- Each opportunity has a distinct lifecycle

**Relationship:**
- Business → has many → Opportunity
- Opportunity → linked from → Conversation (audit trail)

---

#### Activity
**Purpose:** Immutable append-only audit trail  

**Attributes:**
- `id` (UUID)
- `business_id` (FK to Business)
- `actor_id` (FK to user, nullable if system action)
- `action_type` (added_to_leads, enriched, campaign_added, message_sent, reply_received, stage_changed, etc.)
- `timestamp`
- `context` (JSON, flexible)
- `metadata` (what changed, from/to values)

**Why separate entity?**
- Complete immutable record of everything that happened
- Enables "show me the history of this business"
- Enables future compliance/audit requirements

**What gets logged:**
- Business created
- Business enriched (and version change)
- Business added to campaign
- Email sent
- Reply received
- Opportunity created
- Opportunity stage changed
- Everything

---

#### Tags
**Purpose:** User-defined categorization  

**Attributes:**
- `business_id` (FK to Business)
- `tag` (string, indexed)
- `created_at`

**Why separate entity?**
- Enables many-to-many (one business, many tags)
- Enables efficient tag filtering

---

#### Notes
**Purpose:** User-added context and observations  

**Attributes:**
- `id` (UUID)
- `business_id` (FK to Business)
- `content`
- `created_at`
- `updated_at`

**Why separate entity?**
- Notes accumulate (don't overwrite)
- User can see history of their observations
- Supports threading or inline display

---

### 2.2 Entity Relationship Diagram

```
User
  │
  ├─── owns ──→ Business
  │              │
  │              ├─── has many ──→ Commercial Intelligence (versioned)
  │              │
  │              ├─── has many ──→ Conversation
  │              │                  │
  │              │                  ├─── has many ──→ Message
  │              │                  │
  │              │                  └─── created ──→ Opportunity
  │              │
  │              ├─── has many ──→ Opportunity
  │              │
  │              ├─── has many ──→ Activity (append-only)
  │              │
  │              ├─── has many ──→ Tags
  │              │
  │              └─── has many ──→ Notes
  │
  ├─── creates ──→ Campaign
  │                  │
  │                  └─── has many ──→ Campaign Membership
  │                                      │
  │                                      └─── references ──→ Business
```

**Key principle:** Business is the hub. Everything else orbits it or references it. No circular dependencies.

---

## 3. MODULE RESPONSIBILITIES

### 3.1 Dashboard

**Purpose:** Operational overview at a glance  

**Reads:**
- Count of businesses in each status
- Recent activity (from Activity table)
- Pipeline summary (count by stage)
- Reply volume (from Conversation)
- Next actions (AI suggestions, optional)

**Allowed Actions:**
- View only (no editing)
- Navigate to other modules
- See activity feed
- See pipeline health

**Belongs Here:**
- KPIs (leads added, conversations started, opportunities created)
- Quick stats (total businesses, qualified, in pipeline)
- Recent activity feed
- Next-action suggestions

**Does NOT belong:**
- Editing business data
- Campaign management
- Email composition
- Detailed business view
- Outreach execution

**Implementation:** Aggregation queries over core entities. No mutations.

---

### 3.2 Discover

**Purpose:** Acquire businesses  

**Reads:**
- Businesses not yet in user's "My Leads"
- Search results
- Import preview

**Allowed Actions:**
- Search for businesses
- Import CSV/bulk
- View business preview
- Check for duplicates
- Add to My Leads
- Enqueue for enrichment

**Belongs Here:**
- Search/query interface
- Deduplication checks
- Bulk import interface
- Business preview (without CI yet)
- Source attribution (where business came from)
- Enrichment queue trigger

**Does NOT belong:**
- Campaign management
- Conversation history
- Opportunity tracking
- Long-term business storage
- Detailed enrichment display

**Implementation:** Create Business → enqueue Commercial Intelligence → link to user

---

### 3.3 My Leads

**Purpose:** Permanent business repository and qualification workspace  

**Reads:**
- All businesses owned by user
- Commercial Intelligence (latest version)
- Tags, notes
- Activity history
- Recent conversations (if any)

**Allowed Actions:**
- View business with full enrichment
- Add/edit tags and notes
- Mark as qualified/ready
- Add to campaign
- View enrichment history
- Manually re-enrich
- Archive/restore
- Delete (soft)

**Belongs Here:**
- Complete business record view
- CI display and versioning
- Qualification state
- Tag and note management
- History/audit trail display
- Enrichment trigger

**Does NOT belong:**
- Campaign management (go to Outreach)
- Email composition (go to Outreach)
- Opportunity creation (happens when conversation matures)
- Email execution state

**Implementation:** Query Business + latest CI + Tags + Notes + Activity. Support tagging and enrichment.

---

### 3.4 Outreach

**Purpose:** Plan and execute targeted business outreach  

**Reads:**
- Campaigns
- Campaign Memberships
- Businesses in campaign
- Conversations (per business)
- Email templates
- Outreach status (drafted, sent, replied)

**Allowed Actions:**
- Create campaign
- Add businesses to campaign
- View businesses in campaign
- Preview enrichment (for personalization)
- Create/edit email drafts
- Send emails
- Track delivery, opens, clicks
- Capture replies
- View conversation history

**Belongs Here:**
- Campaign creation and management
- Campaign membership (which businesses)
- Email template selection
- Draft composition and personalization
- Send scheduling
- Delivery and reply tracking
- Reply capture and classification
- Conversation thread per business

**Does NOT belong:**
- Business data storage (reference from My Leads)
- Opportunity management (Pipeline)
- CI enrichment (done in Discover/My Leads)
- Long-term business status (that's My Leads)

**Implementation:** Campaign → Campaign Membership → Business (reference) → Conversation → Message (emails)

---

### 3.5 Pipeline

**Purpose:** Manage opportunities and deal progression  

**Reads:**
- Opportunities (all stages)
- Business data (for context)
- Conversation history (to see deal origin)
- Deal value and probability
- Activity (for deal history)

**Allowed Actions:**
- View all opportunities by stage
- Move opportunity to next stage
- Update deal value
- Update probability
- Close opportunity (won/lost)
- View conversation origin
- Add opportunity notes

**Belongs Here:**
- Opportunity lifecycle (lead → qualified → proposal → negotiation → closed)
- Deal tracking and forecasting
- Won/lost analysis
- Stage transition (kanban or table view)

**Does NOT belong:**
- Email management
- Conversation threading (that's in Outreach)
- Business qualification (that's My Leads)
- Campaign management

**Implementation:** Opportunity entity with business reference, conversation audit trail, stage progression.

---

### 3.6 Future: AI Agents

**Purpose:** Autonomous actions on businesses (v2+)  

**Reads:**
- Businesses
- Conversations
- CI data
- Opportunities

**Allowed Actions:**
- Suggest next steps based on conversation history
- Recommend lead scoring
- Suggest stage transitions
- Monitor for new signals (e.g., company news)
- Suggest reply messages
- Auto-enrich certain fields
- **Critically: Request user approval before material actions**

**Belongs Here:**
- AI-generated suggestions
- Autonomous enrichment
- Conversation analysis
- Win/loss pattern recognition
- Next-step recommendations

**Does NOT belong:**
- Owning business data (references only)
- Creating parallel data structures
- Operating without user visibility
- Hiding actions from audit trail

**Implementation:** Agents write to existing entities (Opportunity, Commercial Intelligence, Activity). No parallel tables. All actions visible in activity log.

---

## 4. USER JOURNEY

**User:** Freelancer freelance developer/designer seeking more client work  
**Objective:** "I need more clients" (not "collect leads")  
**Time:** 60 minutes, 3x per week

### 4.1 Journey Map

**Session 1: Initial Setup (10 minutes)**
```
Opens ALPA
  ↓
Navigates to Discover
  ↓
Searches for "web development agencies in California"
  ↓
Reviews results (20-30 companies)
  ↓
"These look promising"
  ↓
Adds 15 companies to My Leads
  ↓
ALPA enqueues enrichment for all 15
  ↓
Closes Discover
```

**Session 2: Qualification (25 minutes)**
```
Opens My Leads
  ↓
Filters to "needs_review" (businesses added but not yet qualified)
  ↓
For each business:
  - Reads enrichment summary
  - Reads full CI data (services, team size, etc.)
  - Thinks: "Do they need my services?"
  - Adds tags: "budget_fit", "timing_good", "already_have_vendor"
  - Adds note: "CEO follows me on Twitter" or "They use outdated tech"
  ↓
Marks 8 as "ready_for_outreach"
↓
"These 8 are my ICP. Let's reach out."
```

**Session 3: Campaign & Outreach (25 minutes)**
```
Navigates to Outreach
  ↓
Creates campaign: "Q3 Design Agencies"
  ↓
Adds 8 qualified businesses to campaign
  ↓
Sees 8 rows: [company name] [status: not_started]
  ↓
For each business:
  - Reads enrichment again (for personalization hooks)
  - Sees template: "Hey [company], I noticed you use [technology]. I specialize in..."
  - Personalizes template: "Hey [company], I noticed your portfolio features [specific work]. That's exactly the kind of design I do."
  - Marks draft as "ready_to_send"
  ↓
Reviews all 8 drafts (takes 2 minutes)
  ↓
"Looks good, send them"
  ↓
ALPA sends 8 emails
  ↓
Campaign status: "in_progress"
```

**Session 4: Monitor (passive, over 1 week)**
```
Day 1: Nothing
Day 2: 2 replies received
Day 3: ALPA notification: "2 new replies to your Q3 campaign"
  ↓
Opens ALPA
  ↓
Navigates to Outreach
  ↓
Sees [company A] has replied
  ↓
Clicks conversation
  ↓
Sees full thread:
  - My outreach email
  - Their reply: "Sounds interesting, let's talk"
  ↓
Tone detected: interested ✓
  ↓
"This is a real opportunity"
  ↓
Decides: "Create opportunity"
  ↓
ALPA creates Opportunity
  ↓
Opportunity now appears in Pipeline
  ↓
Navigates to Pipeline
  ↓
Sees opportunity in "lead" stage
  ↓
Thinks: "They're definitely interested, move to qualified"
  ↓
Drags to "qualified" stage
  ↓
Next step: "Schedule intro call"
  ↓
Adds note: "Call scheduled for Thursday"
```

**Session 5: Pipeline Management (5 minutes, as opportunities progress)**
```
Over next 2 weeks:
  - Opportunity moves: lead → qualified → proposal → negotiation
  - Negotiation lasts 3 days
  - Contract signed
  - Move to "customer"
  ↓
Dashboard updates:
  - Opportunity removed from pipeline
  - Business status changes: "active" → could add "customer" tag
  - Activity log shows: "Opportunity closed: won"
```

### 4.2 Time Allocation

**Where users spend 80% of time:**
- Discovering businesses (Discover module)
- Reviewing enrichment and qualifying (My Leads module)
- Personalizing outreach messages (Outreach module)

**Where users spend 15% of time:**
- Composing/sending campaigns (Outreach module)

**Where users spend 5% of time:**
- Pipeline management (Pipeline module)

### 4.3 Decision Points (Not Buttons)

**Decision 1 (Discover):**
"Which businesses match my ICP?"
→ User action: add to My Leads

**Decision 2 (My Leads):**
"Are these businesses actually qualified?"
→ User action: tag, mark ready for outreach

**Decision 3 (My Leads → Outreach):**
"Which of my qualified businesses should I reach out to now?"
→ User action: add to campaign

**Decision 4 (Outreach):**
"What's a personalized message that doesn't sound like spam?"
→ User action: edit draft, send

**Decision 5 (Conversation):**
"Is this reply genuine interest or just being polite?"
→ User action: create opportunity (if yes)

**Decision 6 (Pipeline):**
"Which stage is this deal actually in?"
→ User action: move stage

---

## 5. DATA RELATIONSHIPS

### 5.1 Relationship Definitions

**Business owns Commercial Intelligence (1:N)**
- Business created: `id`, `website`, `location`, etc.
- User discovers business
- CI enrichment queued
- Results stored: new CI record (version 1)
- Later: user requests re-enrichment
- Results stored: new CI record (version 2)
- Dashboard/My Leads query: CI version 2 (latest)
- History query: can see version 1, 2, etc.
- Ownership: CI records are child of Business
- Lifecycle: CI deleted if Business deleted

**Business has Conversation (1:N)**
- Business exists in My Leads
- Campaign sends outreach to business
- Message created (outbound email)
- Reply received
- Message created (inbound reply)
- Both messages belong to Conversation
- Conversation linked to Business and Campaign
- Ownership: Conversation is child of Business
- Lifecycle: Conversation persists; can create Opportunity from it

**Conversation created Opportunity (1:1 or 1:N)**
- Conversation shows engagement
- User decides: "This is an opportunity"
- Opportunity created with reference to Conversation and Message
- Audit trail: can see exactly which message sparked opportunity
- Multiple opportunities from same business over time
- Ownership: Opportunity child of Business, rooted in Conversation
- Lifecycle: Opportunity moves through stages; can be won or lost

**Campaign references Business via Membership (N:N)**
- Campaign created (container)
- Add 10 businesses
- Creates 10 Campaign Membership records
- Each membership is distinct thread (same business can be in Campaign A and B with different status)
- Ownership: Campaign Membership child of Campaign, references Business
- Lifecycle: Membership deleted when campaign ends; Business unaffected

**Activity logs everything (1:N per Business)**
- Every action against a Business → Activity record
- Immutable append-only log
- Enables: "Show me the history"
- Enables: Compliance/audit
- Ownership: Activity child of Business
- Lifecycle: Activity persists; never deleted or updated

### 5.2 Ownership and Lifecycle

**Business is the top-level entity:**
```
Business (owned by user)
  ├─ belongs_to → User
  ├─ has_many → Commercial Intelligence
  ├─ has_many → Conversation
  ├─ has_many → Opportunity
  ├─ has_many → Activity
  ├─ has_many → Tags
  └─ has_many → Notes

Campaign (owned by user)
  ├─ belongs_to → User
  └─ has_many → Campaign Membership
       └─ references → Business

Conversation (owned by business)
  ├─ belongs_to → Business
  ├─ references → Campaign (optional)
  └─ has_many → Message

Opportunity (owned by business)
  ├─ belongs_to → Business
  └─ created_from → Conversation
```

**Deletion cascades:**
- Delete Business → delete all related CI, Conversations, Opportunities, Activities, Tags, Notes, Campaign Memberships
- Delete Campaign → delete Campaign Memberships (Businesses unaffected)
- Delete Conversation → referenced Opportunities become "orphaned" (but remain for history)

---

## 6. EVOLUTION STRATEGY

### 6.1 Current vs Target Schema

**Today:**
- Table: `leads` (contains businesses)
- Table: `pipeline` (contains opportunities or stages?)
- Table: `outreach_queue` (contains email state)
- Table: `commercial_intelligence_queue` (contains enrichment work)
- Unclear: where are enrichment results? (`commercial_intelligence` table?)

**Target:**
- Table: `businesses` (renamed from `leads`)
- Table: `commercial_intelligence` (versioned enrichment results)
- Table: `campaigns`
- Table: `campaign_memberships`
- Table: `conversations`
- Table: `messages` (child of Conversation)
- Table: `opportunities` (may already exist as `pipeline`?)
- Table: `activities`
- Table: `tags` (many-to-many)
- Table: `notes`

### 6.2 Progressive Migration (Avoid Big Bang)

**Phase 1: Deduplication & CI Versioning**
- Goal: Fix enrichment architecture before scaling
- Add `commercial_intelligence` table (versioned results)
- Migrate queue to reference CI
- `leads` table unchanged (still core)
- User-facing change: none yet
- Downtime: minimal, data-only
- Risk: low (additive)

**Phase 2: Conversation & Message Architecture**
- Goal: Model email flow correctly
- Add `conversations` table (thread per business, per campaign context)
- Add `messages` table (child of Conversation, email records)
- Migrate `outreach_queue` → Message model
- User-facing change: Outreach module refactored, same UX
- Downtime: Outreach unavailable 30 min
- Risk: medium (requires outreach validation)

**Phase 3: Campaigns & Campaign Membership**
- Goal: Enable many-to-many business-campaign relationships
- Add `campaigns` table
- Add `campaign_memberships` table
- Migrate agent_missions or legacy campaign model → Campaigns
- User-facing change: Campaign creation/management in Outreach
- Downtime: Outreach unavailable 30 min
- Risk: medium (campaign logic must map correctly)

**Phase 4: Opportunities & Pipeline Cleanup**
- Goal: Clarify pipeline entity
- Verify `pipeline` table structure (is it opportunities?)
- Rename if needed or create `opportunities` table
- Link to Conversation (audit trail: where did this deal come from?)
- User-facing change: Pipeline now shows conversation origin
- Downtime: Pipeline unavailable 15 min
- Risk: low (mostly additive)

**Phase 5: Activities & Audit Trail**
- Goal: Comprehensive activity logging
- Use existing `activity_logs` or rename to `activities`
- Log every action: business added, enriched, campaign added, message sent, opportunity created, etc.
- User-facing change: Activity feed in My Leads and Dashboard
- Downtime: none
- Risk: low (read-only feature)

**Phase 6: Rename "leads" → "businesses"**
- Goal: Conceptual clarity
- Rename table or create view
- Update API and UI terminology
- User-facing change: terminology shift (UI says "My Businesses" not "My Leads")
- Downtime: Depends on refactoring scale
- Risk: high (large refactor, must coordinate with other changes)

### 6.3 Backwards Compatibility

**Keep `leads` table as long as possible:**
- All new code references it via alias "businesses"
- Gradually migrate features to use new tables (CI, Conversations, etc.)
- Eventually rename when safety-critical
- Allows rollback at each phase

**Deprecation timeline (example):**
- Phase 1-5: New architecture co-exists with legacy
- Phase 6: Terminology shift (view level)
- Phase 7+: Future refactors can remove legacy if needed

**Data integrity during migration:**
- All migrations run in transactions
- Rollback procedures documented
- Parallel run during validation (new + old for 24 hours)

---

## 7. SCALABILITY

### 7.1 At Different Scales

**100 Businesses (freelancer starting)**
- Single queries: all < 10ms
- No indexes needed beyond primary keys
- Manual processes work fine

**1,000 Businesses (growing freelancer)**
- Need indexes:
  - `(user_id, status)` on Business (My Leads filtering)
  - `(business_id)` on Conversation (show all conversations for business)
  - `(campaign_id)` on Campaign Membership (show businesses in campaign)
- Queries still < 100ms
- Activity log still manageable

**10,000 Businesses (agency)**
- Need composite indexes:
  - `(user_id, created_at DESC)` on Business
  - `(user_id, status)` on Business
  - `(campaign_id, added_at)` on Campaign Membership
  - `(business_id, created_at DESC)` on Activity
- Most queries < 100ms with proper indexes
- Activity log queries benefit from partitioning by date (future)

**1,000,000 Businesses (ALPA platform, multi-tenant)**
- Indexes alone not enough; need:
  - Partitioning by user_id (sharding)
  - Caching layer (Redis) for:
    - Latest CI version per business
    - Recent activity per business
    - Campaign membership queries
  - Read replicas for reporting queries
  - Archival of old Activity records (move to cold storage after 1 year)
- But **architecture doesn't change**

### 7.2 Architectural Stability

**Does this architecture break at scale?** No.

**What scales?**
- Business record: immutable, never needs to move
- CI versioning: new records added, old records archived
- Conversations: append-only, can be archived per year
- Opportunities: relatively small number per business
- Campaign membership: linear with businesses × campaigns (still manageable)
- Activity: append-only, can be partitioned by date

**What optimizations are needed at scale?**
- Caching for "latest CI version" (computed once, cached)
- Indexes on query patterns
- Archival for activity older than 2 years
- Read replicas for analytics
- Background jobs for expensive aggregations

**None of these require rethinking the fundamental architecture.**

---

## 8. BUILD ORDER

### Recommended Phasing

**Phase 0: Foundation (Weeks 1-2)**
- **Objective:** Fix enrichment architecture
- **Scope:** Add CI versioning
- **Why now?** CI is broken today (results overwritten, no history)
- **Dependencies:** None (independent)
- **Risk:** Low
- **User impact:** None (internals only)
- **Deliverable:** Versioned enrichment with history view

**Phase 1: Conversation Architecture (Weeks 3-4)**
- **Objective:** Model email flow as Conversation + Message
- **Scope:** Add Conversation and Message tables, migrate outreach_queue logic
- **Why now?** Required for proper Outreach module UX
- **Dependencies:** Phase 0 (optional, can be parallel)
- **Risk:** Medium (refactors Outreach, must validate)
- **User impact:** Outreach module redesigned, same UX
- **Deliverable:** Conversations visible in Outreach; message history tracked

**Phase 2: Campaigns & Membership (Weeks 5-6)**
- **Objective:** Explicit Campaign and Campaign Membership entities
- **Scope:** Add Campaign and Campaign Membership tables, simplify campaign logic
- **Why now?** Foundation for many-to-many business-campaign model
- **Dependencies:** Phase 1 (Outreach flow)
- **Risk:** Medium (campaign logic complex)
- **User impact:** Campaign creation flow improves
- **Deliverable:** Campaigns can contain multiple businesses; same business in multiple campaigns works

**Phase 3: Opportunities & Pipeline (Weeks 7-8)**
- **Objective:** Clarify Opportunity entity, link to Conversation
- **Scope:** Verify/refine `pipeline` table, add Conversation reference
- **Why now?** Creates audit trail (opportunity origin)
- **Dependencies:** Phase 1 (Conversation exists)
- **Risk:** Low (mostly additions)
- **User impact:** Pipeline shows "created from" context
- **Deliverable:** Opportunity auditing; conversation → opportunity flow clear

**Phase 4: Activities & Audit Trail (Weeks 9-10)**
- **Objective:** Comprehensive activity logging
- **Scope:** Implement Activity logging across all modules
- **Why now?** Low-impact feature, improves observability
- **Dependencies:** Phase 0-3 (everything else defined)
- **Risk:** Low
- **User impact:** Activity feed in My Leads and Dashboard
- **Deliverable:** Complete audit trail; "show me history" enabled

**Phase 5: Terminology Shift (Weeks 11-12)**
- **Objective:** Rename "leads" → "businesses" in UI/documentation
- **Scope:** Update terminology, documentation, user-facing strings
- **Why now?** After new architecture validated, safe to rebrand
- **Dependencies:** Phase 0-4 (new architecture in place)
- **Risk:** Medium (large refactor, coordination)
- **User impact:** UI terminology clarified ("My Businesses" not "My Leads")
- **Deliverable:** Consistent product terminology

### Why This Order?

1. **Foundation first:** Fix broken enrichment (Phase 0) before adding new features
2. **Conversational core:** Conversation + Message model (Phase 1) is required for Outreach UX
3. **Campaign simplification:** Campaign Membership (Phase 2) simplifies business-campaign relationships
4. **Opportunity auditing:** Link to Conversation (Phase 3) enables history
5. **Observability:** Activity logging (Phase 4) is low-risk audit trail
6. **Terminology:** Final user-facing rename (Phase 5) once foundation is solid

**Total: 12 weeks for complete architecture evolution**

---

## 9. CHALLENGE YOUR OWN DESIGN

### 9.1 Potential Weaknesses

**Weakness 1: Are Business attributes immutable or not?**
- **Problem:** Design says website is immutable (dedup key), but companies change websites
- **Challenge:** If business changes website, do we create a new Business record or update existing?
- **Answer:** Immutable for deduplication purposes. If business changes website in reality, that's captured as a note/activity. We don't split the record. The "same company" logic is based on company_name + location, not website alone.
- **Mitigation:** Website field is "primary website," not "all websites ever owned"

**Weakness 2: Is Campaign Membership necessary or over-engineered?**
- **Problem:** Could we just add `campaign_id` to Business and have many businesses per campaign?
- **Challenge:** That would mean Business status is "in Campaign A," not allowing same business in A and B simultaneously
- **Answer:** Campaign Membership is necessary for many-to-many with distinct state per relationship. Essential.
- **Mitigation:** None needed; this is correct

**Weakness 3: Should Conversation be campaign-specific or business-specific?**
- **Problem:** Design says Conversation links to Campaign (optional). What if I email same business in multiple campaigns?
- **Challenge:** Do we create separate Conversations or one per business?
- **Answer:** One Conversation per business. Campaign link is optional context (which campaign triggered it?). Multiple campaigns emailing same business: one Conversation, multiple Message records.
- **Mitigation:** Clear in schema; conversation.campaign_id is nullable and informational

**Weakness 4: Will Activity table get too large?**
- **Problem:** Billions of rows at scale (1M businesses × 100 activities each = 100M rows)
- **Challenge:** Queries like "activity history" could be slow
- **Answer:** Activity table is append-only. Queries are fast (just ORDER BY timestamp DESC LIMIT 50). At 100M rows, index on (business_id, created_at) is efficient. After 2 years, archive old activities to cold storage.
- **Mitigation:** Plan for archival in Phase 4

**Weakness 5: Should Pipeline be a property on Business or separate Opportunity entity?**
- **Problem:** Design says Opportunity is separate. But Opportunity references Business and Conversation. Could we just have Business.opportunity_stage?
- **Challenge:** Over time, same business has many opportunities. Can't store in Business record.
- **Answer:** Opportunity must be separate entity. Confirmed.
- **Mitigation:** None needed

**Weakness 6: Is CI versioning wasteful?**
- **Problem:** Storing every enrichment result creates lot of data (50KB × 1M businesses × 4 enrichments = 200GB)
- **Challenge:** Is history worth the storage cost?
- **Answer:** Yes. For small freelancer (100 businesses): 5MB total. For agency (10K): 500MB. For platform (1M): 50GB (acceptable with archival after 2 years). History enables "what did we know?" which is valuable for compliance and analytics.
- **Mitigation:** Implement archival; move old CI to cold storage

### 9.2 Simplification Opportunities

**Opportunity 1: Remove Campaign Membership table**
- **Could we:** Just add campaign_id array to Business?
- **Why not:** Would require Postgres array type; migrations complex; querying "which businesses in this campaign" becomes harder
- **Verdict:** Keep Campaign Membership; clear and simple

**Opportunity 2: Combine Message into Conversation**
- **Could we:** Store all messages as JSONB array in Conversation?
- **Why not:** Messages are high-volume; better as separate table. Enables efficient pagination ("show me next 20 messages")
- **Verdict:** Keep Message separate; simple

**Opportunity 3: Merge Activity into Business**
- **Could we:** Store activity_log column (JSONB) on Business?
- **Why not:** Activity table can grow to millions of rows; would bloat Business queries. Activity queries are independent (show history).
- **Verdict:** Keep Activity separate; correct design

**Opportunity 4: Remove Notes, store in Activity**
- **Could we:** Log notes as activities instead of separate table?
- **Why not:** Notes are mutable (user edits notes). Activities are immutable. Different model.
- **Verdict:** Keep Notes separate; correct

### 9.3 Future Limitations

**Limitation 1: Will we ever have shared access to businesses?**
- **Problem:** Current design: one user owns all businesses
- **Future:** Multiple team members accessing same lead
- **Answer:** Add team_id and permission model. Not in Phase 0-5; built on top of this architecture.

**Limitation 2: Will we ever need real-time updates (websockets)?**
- **Problem:** If two people are in same Conversation, do they see updates in real-time?
- **Answer:** Not needed for Phase 0-5. Refetch on focus or 30s polling. WebSockets can be added layer.

**Limitation 3: Will we ever need data warehousing for BI?**
- **Problem:** Reporting at scale requires separate analytics DB
- **Answer:** Yes, eventually. Use read replicas today; migrate to data warehouse later. Architecture doesn't prevent this.

---

## 10. SUMMARY

### What Stays (Strengths to Preserve)

✅ Business table as immutable core  
✅ RLS policies for user isolation  
✅ Activity logging infrastructure  
✅ Separate enrichment queue  
✅ Email sending architecture  

### What Evolves (Fixes to Make)

🔄 Rename "leads" → "businesses" (terminology)  
🔄 Add CI versioning (prevent overwrites)  
🔄 Model Conversation + Message (email flow)  
🔄 Add Campaign + Campaign Membership (many-to-many)  
🔄 Clarify Opportunity entity (opportunity origin)  
🔄 Comprehensive Activity logging (audit trail)  

### What Disappears (Simplifications)

❌ Unclear agent_missions vs campaigns (consolidate)  
❌ Legacy state machines (unify to Activity)  
❌ Over-engineered admin utilities (simplify)  

### Result

An elegant, scalable architecture where:
- Business is the permanent, immutable center
- Everything references Business (no duplicates)
- Every action is logged (complete audit trail)
- Modules are operational views, not data silos
- Scales from freelancer (100 businesses) to platform (1M+ businesses)
- Future AI agents enhance rather than duplicate
- User journey focuses on high-value work (discovery, qualification)

**This blueprint is production-ready. Implement Phase 0-5 over 12 weeks and ALPA becomes the platform it should be.**

