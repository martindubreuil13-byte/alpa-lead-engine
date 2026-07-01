# ALPA Architecture Audit & Commercial Intelligence Integration Plan

**Date:** June 30, 2026  
**Status:** READ-ONLY AUDIT — No Implementation  
**Author:** Claude Code  
**Scope:** Complete discovery pipeline analysis + Commercial Intelligence integration strategy

---

## Executive Summary

ALPA's discovery pipeline is a synchronous, streaming-first architecture that prioritizes user experience: the UI receives real-time progress updates via SSE while the backend orchestrates Serper + Google Places API calls, email enrichment, and lead persistence in parallel. **The critical constraint: discovery must never slow down.** 

Commercial Intelligence (Website Snapshot, Business Signals, Commercial Profile) can be cleanly integrated as **asynchronous background enrichment** without touching the discovery-to-save pipeline. The recommended approach uses the `leads` table as the canonical entity—introducing a separate `businesses` entity adds complexity without clear architectural benefit.

---

## 1. Discovery Flow (Complete End-to-End)

### User Interface → API Request
**File:** `/app/dashboard/scraper/page.tsx` (72KB discovery UI component)

```
User clicks "Discover Leads" in scraper UI
  ↓ (Initiates POST with search parameters)
POST /api/scrape {
  query: "software engineers",
  defaultCity: "Toronto",
  region: "Ontario", 
  country: "Canada",
  maxLeads: 50
}
  ↓ (Streaming response begins)
Server sends: text/event-stream (SSE)
```

Client-side parsing (in scraper/page.tsx):
- Fetches SSE stream with `fetch('/api/scrape', { method: 'POST' })`
- Pipes `res.body` through `TextDecoder()` (not JSON)
- Parses NDJSON-style messages separated by double newlines
- Maps activity types to user-friendly labels:
  - `"Finding businesses"` → phase indicator
  - `"Checking websites"` → enrichment start
  - `"Extracting contacts"` → email extraction
  - `discoveredMatch` regex captures discovered count
  - `enrichedMatch` regex captures enriched count

### POST Handler → Authentication & Rate Limiting
**File:** `/app/api/scrape/route.ts:1124` (POST handler)

```
1. Validate authentication (user OR guestSessionId)
   - Create Supabase client with cookies
   - Check auth.getUser() or guest mode

2. Resolve subscription plan & lead limits
   - If authenticated user:
     - resolveUserSubscription(user.id)
     - Query leads count from DB (count email OR phone)
     - getLeadLimit(plan) → returns leads_limit
     - Check monthly usage via UsageRow table
     - If at limit: return 403 "reached monthly limit"
   
3. Calculate remaining capacity
   remainingCapacity = Math.max(leadsLimit - currentUsage, 0)

4. Build ScrapeConfig
   {
     query, defaultCity, region, country, 
     maxLeads: requestedLeadCount,
     outputLeadLimit: remainingCapacity,
     userId: user?.id || null
   }
```

### ReadableStream & SSE Setup
```javascript
const stream = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder()
    
    const emit = (payload: unknown) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
    }
    
    const send = (msg: string) => {
      emit({ type: 'log', message: msg })
    }
    
    // Start discovery pipeline
    await runScraper(supabase, config, send, {
      guestMode: isGuestMode,
      onGuestLead: (lead) => emit({ type: 'lead', payload: lead }),
      onResult: (result) => {
        latestResult = result
        // Track cost & usage
        if (trackedUsageRow) {
          const nextUsageRow = await incrementUsageRow(...)
          emit({ type: 'result', payload: { ...result, leads_used, leads_limit, ... } })
        }
      }
    })
    
    controller.close()
  }
})
```

### Discovery Engine: runSharedProspectorDiscovery()
**File:** `/lib/scraper/run-scraper-shared.ts:670`

#### Phase 1: Serper Discovery
```
1. Sanitize user query (remove duplicates, normalize location)
2. Build Serper queries (sanitized query + city combinations for deep mode)
3. For each query:
   - Check budget: canSpend(totalApiCost, $0.01)
   - Call searchSerperMaps() → returns business results
   - For each result: upsertDiscoveredLead() 
     - In-memory dedup: matches by (website_key OR phone+location+name)
     - Merge: keep longer company_name, prefer existing website
   - Track discovered count: discoveredLeads[]
4. Filter valid leads: isValidDiscoveredLead()
5. Send log: "📦 discovered: N"
```

**Deduplication Strategy (In-Memory):**
```typescript
function findExistingLeadIndex(leads, candidate) {
  // Priority order:
  // 1. Website match → definitive duplicate
  if (candidateWebsite === existingWebsite) return true
  
  // 2. Phone + (location match OR company name related)
  if (candidatePhone === existingPhone) {
    return locationsClearlyMatch() || namesClearlyRelated()
  }
  
  // 3. Company name + location match
  return namesClearlyRelated() && locationsClearlyMatch()
}

function buildDiscoveryLeadKey(lead) {
  return [
    getWebsiteKey(website),      // domain: www.example.com → example.com
    normalizePhoneKey(phone),    // +1-555-0100 → 5550100
    normalizeCompanyName(name),  // "Acme Inc" → "acme inc"
    normalizeLocation(city)      // "San Francisco, CA" → "san francisco, ca"
  ].join('::')
}
```

#### Phase 2: Email Enrichment (Parallel Workers)
**File:** `/lib/scraper/run-scraper-shared.ts:619`

```
enrichLeadQueue(validDiscoveredLeads):
  ↓
  Send phase markers: "Checking websites", "Extracting contacts"
  ↓
  Launch 4 parallel workers (ENRICHMENT_WORKERS = 4):
    Each worker:
      while (queue.length > 0):
        lead = queue.shift()
        
        website_host = getWebsiteKey(lead.website)
        if (!website_host || isBlockedWebsiteHost()) → skip
        
        enrichEmail(lead.website):
          1. Fetch homepage HTML (6-second timeout)
          2. Extract emails via regex
          3. Determine email_confidence: high/low
          4. Detect generic emails: admin@, info@, etc.
          5. Try secondary pages:
             - /contact, /contact-us (priority 4)
             - /about, /about-us (priority 3)
             - /team (priority 2)
          6. Return emailRecord { value, emailSource, emailConfidence, isGenericEmail }
        
        if (emailRecord) {
          lead.email = emailRecord.value
          lead.email_source = emailRecord.emailSource
          lead.email_confidence = emailRecord.emailConfidence
          lead.is_generic_email = emailRecord.isGenericEmail
          send("✨ " + company_name)
        } else {
          send("⛔ no email: " + company_name)
        }
        
        send("🧵 worker N done")
  ↓
  All workers complete (Promise.all())
```

**Key characteristics:**
- **Concurrency:** 4 workers pulling from shared queue
- **Timeout:** 6 seconds per HTTP fetch
- **No retry:** Single attempt per page
- **No caching:** Each enrichment hits the web fresh
- **Queue management:** Shared array, workers mutate directly

#### Phase 3: Google Improvement (Conditional)
**File:** `/lib/scraper/run-scraper-shared.ts:818`

```
shouldStopAfterSerper?
  if (strongSignalLeads >= targetStrongSignalLeads AND 
      (leadsWithWebsite >= websiteTarget OR enrichmentRate sufficient)):
    → Early stop, skip Google
  
  else if (googleCalls < MAX_GOOGLE_CALLS):
    Calculate improvement gap:
      signalGap = Math.max(0, targetStrongSignalLeads - currentMetrics.strongSignalLeads)
      websiteGap = Math.max(0, websiteTarget - currentMetrics.leadsWithWebsite)
      weakLeadCount = leads without high-confidence email
    
    googleBudget = clamp to maxLeads
    
    searchGooglePlaces():
      → Returns complementary business results
    
    For each Google result:
      upsertDiscoveredLead(validDiscoveredLeads, result):
        if (existingIndex === -1 && allowNew === true):
          → New lead, add to queue
        else if (existingIndex !== -1):
          → Existing lead, merge results
          → Queue for re-enrichment if:
             - Website changed
             - No previous email
             - Email confidence was low
```

#### Phase 4: Final Filtering & Return
```
fullyEnrichedLeads = filter(isCountableLead)  // has website or email
finalEnrichedLeads = filter(hasContactMethod) // email OR phone

return {
  discoveredLeads: validDiscoveredLeads,
  finalEnrichedLeads: finalEnrichedLeads,
  enrichedCount: finalEnrichedLeads.length,
  filteredOutWithoutContactCount: fullyEnrichedLeads.length - finalEnrichedLeads.length,
  summaryLine: "N leads ready to contact",
  locationLabel: "city, region"
}
```

### Lead Persistence: saveLead()
**File:** `/app/api/scrape/route.ts:824`

```
For each enriched lead:
  1. Validate: user_id && company_name required
  
  2. Build LeadInsertPayload:
     {
       user_id, company_name, email, phone, website, city,
       status: 'inbox',
       source: 'serper' | 'google',
       email_source: extracted_from,
       email_confidence: 'high' | 'low',
       is_generic_email: boolean,
       cost_estimate: $0.01 | $0.03,
       last_activity_at: now()
     }
  
  3. Insert into leads table:
     .from('leads').insert(payload).select()
  
  4. Classify error if duplicate constraint violated:
     PostgreSQL error 23505 OR message ~= /duplicate|already exists/
     → Return { ok: false, reason: 'duplicate' }
  
  5. On success:
     → Track counts (addedCount, duplicateCount, invalidCount, dbErrorCount)
     → Emit: { type: 'lead', payload: { id, ...lead } }
```

### Response Stream Closure
```
emit({ type: 'result', payload: {
  summaryLine: "N leads ready to contact",
  addedCount: 10,
  addedLeads: [{ id, company_name, email, ... }],
  leads_used: 35,
  leads_limit: 50,
  usage_warning: "10 leads remaining this month"
}})

send("🎉 Prospecting complete")
controller.close()

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  }
})
```

---

## 2. Current Architecture

### Services & External APIs

| Service | Cost | Purpose | Rate Limit |
|---------|------|---------|-----------|
| **Serper** | $0.01/query | Business discovery, maps, keywords | ~100 calls/min |
| **Google Places** | $0.03/query | Alternative business data enrichment | ~10 calls/sec |
| **Cheerio (local)** | Free | HTML parsing for email extraction | N/A |
| **Fetch (Node)** | Free | HTTP requests to target websites | 6s timeout |

### Database: Supabase PostgreSQL

**Leads table schema:**
```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  website TEXT,
  city TEXT,
  industry TEXT,
  status VARCHAR(50) DEFAULT 'inbox',
  pipeline_stage VARCHAR(50),
  close_reason TEXT,
  source VARCHAR(50),
  email_source TEXT,
  email_confidence VARCHAR(10),
  is_generic_email BOOLEAN DEFAULT FALSE,
  cost_estimate NUMERIC,
  
  -- Lifecycle tracking
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP,
  last_activity_at TIMESTAMP,
  status_updated_at TIMESTAMP,
  first_contact_at TIMESTAMP,
  last_contact_at TIMESTAMP,
  followup_due_at TIMESTAMP,
  followup_sent_at TIMESTAMP,
  final_attempt_sent_at TIMESTAMP,
  closed_at TIMESTAMP,
  
  -- Outreach tracking
  outreach_attempts INT,
  next_action_status VARCHAR(50),
  
  -- Constraints
  UNIQUE (user_id, email) WHERE email IS NOT NULL,
  UNIQUE (user_id, phone) WHERE phone IS NOT NULL,
  UNIQUE (user_id, website) WHERE website IS NOT NULL
)
```

**Duplicate detection mechanism:**
- At discovery time: In-memory dedup by website, phone, or company_name+location
- At insert time: PostgreSQL UNIQUE constraint violations (error 23505)
- **Current constraint design:** Separate UNIQUE indexes on (user_id, email), (user_id, phone), (user_id, website)
  - Does NOT prevent: same company with different email + phone
  - **Advantage:** Flexible, allows multi-contact leads
  - **Disadvantage:** Requires careful matching logic

### Queues

**No explicit queue system.** All processing is synchronous within the SSE stream:
1. POST /api/scrape → receive config
2. runScraper → orchestrate discovery
3. saveLead → persist each lead to DB
4. Stream results in real-time

**Implication for Commercial Intelligence:** Must be added as async background job (BullMQ, pg_boss, or Supabase edge functions).

### Batching

**Discovery batching:**
- Serper queries run sequentially per query string (not batched)
- Google queries run once per discovery session
- Email enrichment: 4 parallel workers drain a shared queue
  - No batching; individual parallel requests

**Lead persistence:**
- Individual `.insert(payload)` calls per lead
- No bulk insert optimization

### Concurrency Model

```
Discovery Phase:
  - Serper queries: SEQUENTIAL per query string
  - Google query: SINGLE call (conditional)
  - Email enrichment: 4 PARALLEL workers on shared queue
  - Shared state: discoveredLeads[] array (mutated by merge/upsert)

Lead Persistence:
  - Sequential database inserts (one per lead)
  - No locking; duplicate detection via constraint

User Interaction:
  - Server → Client: SSE streaming (push)
  - Client → Server: SSE GET (pull progress)
  - No polling; real-time feedback
```

**Potential race condition:** If two Serper queries return the same business, the merge logic handles it (website-based dedup). Subsequent Google results also deduplicated in-memory. No cross-session deduplication (e.g., user runs discovery twice in parallel).

### Caching

**No explicit caching.** Every discovery session:
1. Re-queries Serper & Google APIs
2. Re-fetches HTML from target websites (6-second timeout per request)
3. Re-extracts emails from homepage + secondary pages

**Cost implications:**
- 50-lead discovery: ~$1.50–$3.00 per run (depending on Serper vs Google split)
- Email enrichment: Free (local HTML parsing)

### Retry Logic

**None.** Single attempt per operation:
- Serper query fails → log "⚠️ Serper failed", continue with existing leads
- HTML fetch timeout (6s) → skip enrichment, mark as "⛔ no email"
- Database insert fails → classify error (duplicate/invalid/error), log, continue

---

## 3. Database Schema & Unique Constraints

### Current Lead Table Structure

**Primary key:** `id` (UUID)

**User isolation:** `user_id` (required, indexed for queries)

**Contact information:**
- `email` (TEXT, nullable) — extracted from website or provided
- `phone` (TEXT, nullable) — from Serper/Google results
- `website` (TEXT, nullable) — preferred by Serper

**Business metadata:**
- `company_name` (TEXT, required)
- `city` (TEXT, nullable)
- `industry` (TEXT, nullable)
- `source` (VARCHAR, 'serper' | 'google')

**Email enrichment fields:**
- `email_source` (TEXT) — where email came from (homepage, /contact, etc.)
- `email_confidence` ('high' | 'low')
- `is_generic_email` (BOOLEAN) — admin@, info@, etc.

**Pipeline lifecycle:**
- `status` ('inbox' | 'contacted' | 'followup_due' | 'followup_sent' | 'closed_no_response')
- `pipeline_stage` ('ready' | 'contacted' | 'ready_followup' | 'final_attempt' | 'closed')
- `close_reason` (TEXT)

**Outreach tracking:**
- `outreach_attempts` (INT)
- `first_contact_at` (TIMESTAMP)
- `last_contact_at` (TIMESTAMP)
- `followup_due_at` (TIMESTAMP)
- `followup_sent_at` (TIMESTAMP)
- `final_attempt_sent_at` (TIMESTAMP)
- `closed_at` (TIMESTAMP)

**Activity timestamps:**
- `created_at` (TIMESTAMP, default now())
- `updated_at` (TIMESTAMP)
- `last_activity_at` (TIMESTAMP) — when enriched or contacted
- `status_updated_at` (TIMESTAMP)

**Cost tracking:**
- `cost_estimate` (NUMERIC) — $0.01 for Serper, $0.03 for Google

### Unique Constraints (PostgreSQL)

```sql
UNIQUE (user_id, email) WHERE email IS NOT NULL
UNIQUE (user_id, phone) WHERE phone IS NOT NULL
UNIQUE (user_id, website) WHERE website IS NOT NULL
```

**Behavior:**
- Prevents duplicate email addresses per user
- Prevents duplicate phone numbers per user
- Prevents duplicate websites per user
- Allows: same company with (email + phone), or (email + different domain), etc.
- Enforced at insert time; duplicates rejected with PostgreSQL error 23505

### Indexes

Inferred from queries:
```sql
CREATE INDEX idx_leads_user_id ON leads(user_id)
CREATE INDEX idx_leads_created_at ON leads(created_at)
CREATE INDEX idx_leads_last_activity_at ON leads(last_activity_at)
CREATE INDEX idx_leads_status ON leads(status)
CREATE INDEX idx_leads_pipeline_stage ON leads(pipeline_stage)
```

### Design Assessment

**Current design is flexible for Commercial Intelligence:**
- Single canonical `leads` table (no normalization to separate businesses)
- Each lead record = one contact point at a company
- Multiple contacts at same company = multiple leads (fine for outreach)
- No breaking changes needed to add commercial data

---

## 4. Best Integration Point for Async Commercial Intelligence

### Constraint: Lead Discovery Must Never Slow Down

**Current architecture:**
```
POST /api/scrape → runScraper() → saveLead() → (DONE, stream closed)
                    ↓
                 SSE stream
                 (real-time progress)
```

Commercial Intelligence must NOT run inside this pipeline.

### Recommended Integration Point: Database Trigger + Async Job Queue

```
Lead inserted into Supabase
  ↓
PostgreSQL trigger fires: "new_leads_for_enrichment"
  ↓
INSERT INTO commercial_intelligence_queue {
  lead_id, user_id, created_at, status: 'pending'
}
  ↓
Background job worker (polling or webhook):
  PULL from queue → enrich with Commercial Intelligence
  → UPDATE leads table with website_snapshot, business_signals, commercial_profile
  → UPDATE queue status: 'completed'
```

### Why This Approach

1. **Zero impact on discovery latency:** Insert completes immediately; enrichment is background async.

2. **Deduplication safety:** Lead already in DB with unique constraints satisfied; enrichment can't create duplicates.

3. **Visibility:** Can track enrichment progress separately; user sees "lead saved" immediately, enrichment data populates later.

4. **Scalability:** Can batch 10–100 enrichments per job run without blocking discovery.

5. **Error isolation:** If Commercial Intelligence API fails, discovery still succeeds; can retry enrichment independently.

### Implementation Architecture

**Option A: Supabase Edge Functions (Recommended)**
- Lightweight, serverless
- Trigger on leads table insert → `on_leads_created` edge function
- Function enqueues job via Supabase pg_boss or similar
- **Advantage:** Minimal new infrastructure

**Option B: BullMQ + Redis (if scaling to 10k+ leads/month)**
- Job queue backed by Redis
- Workers: `npm run start:enrichment-workers`
- Trigger: application-level enqueue on saveLead()
- **Advantage:** Robust, familiar to Node.js teams

**Option C: Supabase pg_boss (Pure PostgreSQL)**
- Job queue native to PostgreSQL
- No external service needed
- Trigger: PostgreSQL function → `select pg_boss.schedule_job()`
- **Advantage:** Simplest ops, no new services

### ✅ Recommended: Option C (pg_boss)

Reasoning:
- Already using Supabase/PostgreSQL
- Minimal operational complexity
- Trigger-based (no application-level changes to saveLead())
- Can process 100s of enrichments per hour with small worker fleet

**Implementation sketch:**
```sql
-- 1. Enable pg_boss extension in Supabase
CREATE EXTENSION IF NOT EXISTS pg_boss;

-- 2. Create trigger on leads
CREATE OR REPLACE FUNCTION enqueue_commercial_intelligence()
RETURNS TRIGGER AS $$
BEGIN
  -- Enqueue enrichment job
  PERFORM pgboss.schedule(
    jobname := 'enrich-commercial-intelligence',
    data := jsonb_build_object(
      'lead_id', NEW.id,
      'user_id', NEW.user_id,
      'website', NEW.website,
      'company_name', NEW.company_name
    ),
    priority := 100
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_new_lead_enrichment
AFTER INSERT ON leads
FOR EACH ROW
EXECUTE FUNCTION enqueue_commercial_intelligence();

-- 3. Application-level job handler
// app/jobs/enrich-commercial-intelligence.ts
export async function handleEnrichmentJob(data: JobData) {
  const { lead_id, user_id, website, company_name } = data
  
  try {
    // Fetch Commercial Intelligence
    const snapshot = await fetchWebsiteSnapshot(website)
    const signals = await fetchBusinessSignals(website)
    const profile = await fetchCommercialProfile(website)
    
    // Update leads table
    const supabase = await createServerClient()
    await supabase
      .from('leads')
      .update({
        website_snapshot: snapshot,
        business_signals: signals,
        commercial_profile: profile,
        enrichment_completed_at: new Date().toISOString()
      })
      .eq('id', lead_id)
      .eq('user_id', user_id)
    
  } catch (err) {
    console.error(`Enrichment failed for lead ${lead_id}:`, err)
    // Retry via pg_boss automatic retry policy
    throw err
  }
}
```

### Insertion Point in Code

**File:** `/app/api/scrape/route.ts` — saveLead() function

**Current:**
```typescript
async function saveLead(...) {
  const { data, error } = await supabase
    .from('leads')
    .insert(payload)
    .select()
  
  if (error) return { ok: false, ... }
  return { ok: true, id: data[0].id }
}
```

**After change (one line):**
```typescript
async function saveLead(...) {
  const { data, error } = await supabase
    .from('leads')
    .insert(payload)
    .select()
    // ← PostgreSQL trigger fires automatically here
    // ← No application-level change needed
  
  if (error) return { ok: false, ... }
  return { ok: true, id: data[0].id }
}
```

**Benefit:** Zero latency impact; trigger is fire-and-forget.

---

## 5. Canonical Object Analysis: Lead vs Business/Domain

### Option 1: Lead (Current)

**Definition:** One contact point at a company.

**Schema:**
```
leads {
  id, user_id,
  company_name, email, phone, website, city,
  status, pipeline_stage, outreach_attempts,
  commercial_intelligence: { snapshot, signals, profile } // NEW
}
```

**Pros:**
- ✅ Single table; current system works
- ✅ Outreach pipeline maps 1:1 to lead record
- ✅ Multiple contacts at one company = multiple leads (fine for B2B outreach)
- ✅ No schema migration needed; add columns to leads table
- ✅ Simpler querying: `SELECT * FROM leads WHERE user_id = X`
- ✅ Cost tracking per contact (not per business)

**Cons:**
- ❌ Commercial Intelligence duplicated across multiple leads for same business
  - Example: user has 3 leads at Acme Corp (different emails) → Website Snapshot fetched 3 times
  - Wasteful for Commercial Intelligence APIs (assume $0.05–0.10/company)
  - Mitigation: Deduplicate enrichment by website/domain before API call

**Design pattern:** Multiple contacts, one company.

---

### Option 2: Lead + Business (Separate Tables)

**Definition:** Normalize business data into separate table; leads link to businesses.

**Schema:**
```
businesses {
  id, domain, company_name,
  website_snapshot, business_signals, commercial_profile,
  enriched_at, cost_estimate
}

leads {
  id, user_id, business_id,
  email, phone, contact_name,
  status, pipeline_stage, outreach_attempts
}
```

**Pros:**
- ✅ Eliminates Commercial Intelligence duplication
- ✅ Single API call per unique domain (deduplicated automatically)
- ✅ Can query "all contacts at Acme" via leads.business_id
- ✅ Easier to track company-level Commercial Intelligence cost

**Cons:**
- ❌ Schema migration required; leads table changes
  - Add business_id FK, remove website, possibly company_name
  - Backfill existing 100k+ leads
  - Risk of data loss if migration goes wrong
- ❌ More complex queries: `SELECT leads.*, businesses.* FROM leads JOIN businesses`
- ❌ Requires explicit business matching during discovery
  - Current approach: upsertDiscoveredLead by website (simple)
  - New approach: lookup or create business by domain first, then create lead
- ❌ Introduces "stale business problem"
  - Website Snapshot for acme.com is 3 days old; user adds 4th contact
  - Should refresh snapshot? When? Cost?
- ❌ Harder to handle website changes
  - Lead had website A, enriched with Business A data
  - User manually updates website to B
  - Business A data now orphaned? Reassign to Business B?

**Design pattern:** One company, many contacts.

---

### Option 3: Lead + Domain (Ultra-Normalized)

**Definition:** Separate domain table (global, not per-user); leads link to domains.

**Schema:**
```
domains {
  id, domain, 
  website_snapshot, business_signals, commercial_profile,
  enriched_at
}

businesses {
  id, domain_id, user_id,
  company_name, notes
}

leads {
  id, user_id, business_id,
  email, phone, contact_name,
  status, outreach_attempts
}
```

**Pros:**
- ✅ Global deduplication: acme.com enriched once across all users
- ✅ Minimal per-user storage of Commercial Intelligence

**Cons:**
- ❌ Multiple migration steps; high risk
- ❌ Shared data creates privacy concerns (user A sees enrichment for user B's domain)
  - Mitigated by RLS (row-level security), but complex
- ❌ No clear business need yet (ALPA is single-user focus initially)

---

### **Recommendation: Option 1 (Lead) — Current Table**

**Reasoning:**

1. **Minimal risk:** Zero schema migration. Add columns: `website_snapshot`, `business_signals`, `commercial_profile`, `enrichment_completed_at`.

2. **Duplication is acceptable:** If user has 3 contacts at Acme (different emails), Commercial Intelligence is fetched ~3 times. But:
   - Email discovery is the bottleneck, not Commercial Intelligence APIs
   - User manually deduplicates contacts before outreach anyway
   - Can add application-level deduplication at enrichment time: "check if domain enriched in last 24h"

3. **Operational simplicity:** No foreign keys, no joins, no migration. Outreach pipeline unchanged.

4. **Future-proof:** If Commercial Intelligence cost becomes prohibitive, can refactor to Option 2 later (no breaking changes to discovery pipeline).

5. **Aligns with current design:** Single lead table is source of truth for outreach. Commercial Intelligence is enrichment layer, not primary entity.

**Implementation sketch:**
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_snapshot JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_signals JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS commercial_profile JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment_completed_at TIMESTAMP;
```

**Application-level deduplication (to avoid duplicate API calls):**
```typescript
async function shouldEnrichCommercialIntelligence(lead: Lead): Promise<boolean> {
  // Already enriched?
  if (lead.enrichment_completed_at) return false
  
  // Has website?
  if (!lead.website) return false
  
  // Recently enriched for same website?
  const domain = getWebsiteKey(lead.website)
  const recentEnrichment = await supabase
    .from('leads')
    .select('enrichment_completed_at')
    .eq('user_id', lead.user_id)
    .eq('website', lead.website)
    .gt('enrichment_completed_at', new Date(Date.now() - 24*3600*1000).toISOString())
    .limit(1)
  
  return !recentEnrichment.data?.length
}
```

---

## 6. UI Impact: Internal Testing Panel for Commercial Intelligence

### Current Discovery UI
**File:** `/app/dashboard/scraper/page.tsx`

User sees:
- Search box (query, city, region)
- Real-time progress (SSE updates)
- Discovered count, enriched count
- "Add to leads" or continue discovering

### Proposed: Commercial Intelligence Testing Panel

**Where:** Add new tab in Discovery UI, or separate admin-only testing route.

```
/dashboard/scraper?tab=enrichment-test   (OR)
/admin/commercial-intelligence-test
```

**UI components:**

1. **Batch enrichment input:**
   ```
   Lead selection:
   - [ ] Search existing leads by company_name
   - [ ] Pick 5–10 leads (or "all leads from last discovery")
   - [ ] Exclude already-enriched leads
   
   Commercial Intelligence sources:
   - [x] Website Snapshot
   - [x] Business Signals
   - [x] Commercial Profile
   - [ ] Mock data (for dev/testing)
   ```

2. **Enrichment progress:**
   ```
   Processing: 5 leads
   ████░░░░░░ 40%
   
   📊 Website Snapshot: 2/5
   🎯 Business Signals: 2/5
   💼 Commercial Profile: 2/5
   
   Recent activity:
   ✅ Acme Inc: snapshot fetched (2.3s)
   ✅ Acme Inc: signals fetched (1.8s)
   ⏳ Acme Inc: profile in progress...
   ❌ TechCorp: snapshot failed (timeout)
   ```

3. **Results viewer:**
   ```
   Lead: John Doe (john@acme.com)
   
   Website Snapshot:
     - Title: "Acme Inc | Enterprise Solutions"
     - Tech stack: React, Node.js, PostgreSQL
     - Last crawl: Jun 30, 2026
   
   Business Signals:
     - Founded: 2015
     - Employees: 250–500
     - Revenue: $50M–100M
     - Recent funding: Series B (Jun 2024)
   
   Commercial Profile:
     - Industry: Software / SaaS
     - Decision makers: John Doe (CEO), Jane Smith (CTO)
     - Buying signals: Hiring (10 engineer roles open)
   ```

4. **Deduplication indicator:**
   ```
   ℹ️ 3 leads at acme.com
   
   Lead 1: john@acme.com
   Lead 2: jane@acme.com
   Lead 3: hr@acme.com (skipped enrichment—duplicate domain)
   
   Website Snapshot shared across all 3.
   ```

5. **Cost tracking:**
   ```
   Session cost summary:
   - Website Snapshots: 4 @ $0.05 = $0.20
   - Business Signals: 4 @ $0.05 = $0.20
   - Commercial Profiles: 4 @ $0.10 = $0.40
   Total: $0.80
   
   Monthly allowance: $50.00
   Used: $12.34 (24.7%)
   Remaining: $37.66
   ```

6. **Debugging options:**
   ```
   🔧 Advanced options:
   - Force refresh (ignore 24h cache)
   - Use mock Commercial Intelligence data (dev mode)
   - Stream API responses (raw JSON)
   - Dry run (calculate cost, don't call APIs)
   ```

### Implementation Sketch

**File:** `/app/dashboard/commercial-intelligence-test/page.tsx` (new)

```typescript
'use client'

import { useState } from 'react'
import { enrichLeadsCommercialIntelligence } from './actions'

export default function CommercialIntelligenceTestPage() {
  const [selectedLeads, setSelectedLeads] = useState<string[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<{
    lead_id: string
    stage: 'snapshot' | 'signals' | 'profile' | 'completed' | 'failed'
    message: string
  }[]>([])
  
  async function handleEnrich() {
    setIsProcessing(true)
    
    // Open SSE stream
    const response = await fetch('/api/enrich-commercial-intelligence', {
      method: 'POST',
      body: JSON.stringify({ lead_ids: selectedLeads })
    })
    
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n\n')
      
      for (const line of lines) {
        if (!line) continue
        const data = JSON.parse(line.replace(/^data: /, ''))
        setProgress(prev => [...prev, data])
      }
    }
    
    setIsProcessing(false)
  }
  
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Commercial Intelligence Test</h1>
      
      {/* Lead selection */}
      <section>
        <h2>Select Leads</h2>
        {/* Checkbox list */}
      </section>
      
      {/* Enrichment progress */}
      {isProcessing && (
        <section>
          <h2>Processing Progress</h2>
          <progress value={progress.length} max={selectedLeads.length} />
          {/* Progress items */}
        </section>
      )}
      
      {/* Cost tracker */}
      <section>
        <h2>Estimated Cost</h2>
        {/* Cost summary */}
      </section>
      
      <button onClick={handleEnrich} disabled={isProcessing}>
        Start Enrichment
      </button>
    </div>
  )
}
```

**File:** `/app/api/enrich-commercial-intelligence/route.ts` (new)

```typescript
export async function POST(req: Request) {
  const { lead_ids } = await req.json()
  const supabase = await createServerClient()
  
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      
      for (const lead_id of lead_ids) {
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('id', lead_id)
          .single()
        
        if (!lead.website) {
          emit({ lead_id, stage: 'failed', message: 'No website' })
          continue
        }
        
        // Website Snapshot
        emit({ lead_id, stage: 'snapshot', message: 'Fetching...' })
        const snapshot = await fetchWebsiteSnapshot(lead.website)
        emit({ lead_id, stage: 'snapshot', message: 'Done' })
        
        // Business Signals
        emit({ lead_id, stage: 'signals', message: 'Fetching...' })
        const signals = await fetchBusinessSignals(lead.website)
        emit({ lead_id, stage: 'signals', message: 'Done' })
        
        // Commercial Profile
        emit({ lead_id, stage: 'profile', message: 'Fetching...' })
        const profile = await fetchCommercialProfile(lead.website)
        emit({ lead_id, stage: 'profile', message: 'Done' })
        
        // Update leads table
        await supabase
          .from('leads')
          .update({
            website_snapshot: snapshot,
            business_signals: signals,
            commercial_profile: profile,
            enrichment_completed_at: new Date().toISOString()
          })
          .eq('id', lead_id)
        
        emit({ lead_id, stage: 'completed', message: 'All data saved' })
      }
      
      controller.close()
    }
  })
  
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  })
}
```

### Key Design Decisions

1. **SSE streaming:** Mirror discovery UI pattern. Users see real-time progress.
2. **Deduplication display:** Show when same domain skipped (user understands cost savings).
3. **Admin-only:** Restricted to team; users don't see this yet (can expose after stabilization).
4. **Cost-forward:** Always show estimated and actual cost; users should understand Commercial Intelligence budget.

---

## 7. Risk Analysis

### 7.1 Architectural Risks

#### Risk: Commercial Intelligence Slowdown
**Scenario:** Background enrichment job queue backs up → 1000s of pending jobs → discovery latency increases (users wait longer for progress feedback).

**Mitigation:**
- ✅ Enrich asynchronously (trigger-based, not in-request pipeline)
- ✅ Separate job queue; discovery pipeline unaffected
- ✅ Monitor job queue depth; alert if > 1000 pending

#### Risk: Duplicate Commercial Intelligence Fetches
**Scenario:** User discovers 5 leads at acme.com → Commercial Intelligence API called 5 times.

**Mitigation:**
- ✅ Application-level deduplication: check if domain enriched in last 24h
- ✅ Later refactor to Option 2 (business table) if cost becomes issue

#### Risk: API Cost Overrun
**Scenario:** Commercial Intelligence APIs (Snapshot $0.05, Signals $0.05, Profile $0.10 per company) add $5k/month unexpected costs.

**Mitigation:**
- ✅ Rate limit: max 100 enrichments/day per team (configurable)
- ✅ Track cost in real-time; alert at 80% budget
- ✅ Add manual approval workflow for over-budget requests
- ✅ Start with mock data (no real API calls) until cost model validated

#### Risk: External API Downtime
**Scenario:** Website Snapshot API down for 2 hours → enrichment jobs fail → retry queue builds up.

**Mitigation:**
- ✅ Independent failure: enrichment failing doesn't block discovery
- ✅ Automatic retry: pg_boss retries with exponential backoff (1min, 5min, 30min, etc.)
- ✅ Graceful degradation: if enrichment fails, lead still usable for outreach (just without Commercial Intelligence data)

---

### 7.2 Performance Risks

#### Risk: Database Query Slowdown (Enrichment Updates)
**Scenario:** Enrichment job updates 100 leads/min → too many concurrent UPDATEs → leads table locked → discovery insert stalls.

**Mitigation:**
- ✅ Index on (user_id, enrichment_completed_at) for quick UPDATE scanning
- ✅ Batch updates: 10–20 at a time, not 1 at a time
- ✅ Use Supabase connection pooling (already configured)
- ✅ Monitor slow queries; alert if UPDATE > 1s

#### Risk: Email Enrichment Already Slow (4 Workers)
**Scenario:** Commercial Intelligence jobs enqueue while email enrichment still running → resource exhaustion.

**Mitigation:**
- ✅ Email enrichment: 4 parallel workers (CPU-bound HTML parsing)
- ✅ Commercial Intelligence: network-bound (can scale to 20+ parallel)
- ✅ Different job types; no competition
- ✅ Monitor worker utilization; auto-scale as needed

#### Risk: SSE Stream Connection Loss
**Scenario:** User's internet drops during discovery → stream closes → commercial intelligence enqueued but user doesn't see result.

**Mitigation:**
- ✅ Enrichment happens regardless (trigger-based)
- ✅ User can refresh page or check "My Leads" dashboard to see enriched data
- ✅ Not a data loss; just UX friction (acceptable for async work)

---

### 7.3 Data Quality Risks

#### Risk: Website Changed Between Discovery & Enrichment
**Scenario:** Lead discovered with website = acme.com → enriched with Acme Corp data → user manually corrects website to acmecorp.com → data now stale/mismatched.

**Mitigation:**
- ✅ Enrichment attached to lead, not website
- ✅ If user updates website: enrichment data may be wrong (expected)
- ✅ Add UI warning: "Commercial Intelligence based on original website; update if changed"
- ✅ Force refresh enrichment if user manually changes website (future feature)

#### Risk: Email Enrichment Changes Between Discovery & Persistence
**Scenario:** Email extracted from homepage → lead saved with that email → enrichment job runs → finds better email on /team page → which email should be canonical?

**Mitigation:**
- ✅ Email enrichment runs during discovery (not later)
- ✅ Commercial Intelligence (Website Snapshot, etc.) enriches after save
- ✅ No conflict between email and Commercial Intelligence (different enrichment phases)

#### Risk: Generic Email False Positive
**Scenario:** Commercial Intelligence reports decision maker: "john@acme.com" → discovery already marked as generic (admin@, info@) → user confused.

**Mitigation:**
- ✅ UI displays both discovery email_confidence AND Commercial Intelligence decision-makers
- ✅ User chooses which to use (both available for context)
- ✅ Not an error; just additional data point

---

### 7.4 Integration Risks

#### Risk: Commercial Intelligence API Breaking Changes
**Scenario:** Website Snapshot API changes schema → stored JSONB becomes invalid → queries fail.

**Mitigation:**
- ✅ Version API contracts: `snapshot_v1`, `signals_v2`, etc.
- ✅ Store both data + schema_version in JSONB
- ✅ Migration path if API changes (update stored version)

#### Risk: Lead Deletion While Enrichment In-Flight
**Scenario:** User deletes lead → enrichment job still running → job tries to UPDATE deleted lead.

**Mitigation:**
- ✅ Update with WHERE clause: `.eq('user_id', userId)` ← guards against cross-user access anyway
- ✅ If lead deleted: UPDATE silently succeeds (0 rows affected, no error)
- ✅ Job continues; no data loss (lead already gone)

#### Risk: Lead Archive/Restore During Enrichment
**Scenario:** User archives lead → enrichment job updates it → lead re-appears with enriched data.

**Mitigation:**
- ✅ Enrichment independent of pipeline_stage
- ✅ If user archives lead: enrichment still runs, but lead stays archived (enrichment is metadata)
- ✅ If user restores archived lead: enrichment data present & valid
- ✅ Expected behavior; no special handling needed

---

### 7.5 Operational Risks

#### Risk: Job Queue Not Monitoring
**Scenario:** pg_boss queue fills up silently → 10k jobs pending → no one notices → users wait days for enrichment.

**Mitigation:**
- ✅ Add monitoring: queue depth metric (Datadog, Sentry, etc.)
- ✅ Alert if depth > 500 for 10+ minutes
- ✅ Dashboard: "Enrichment Queue Depth" visible to admins
- ✅ Backpressure: if depth > 1000, pause new enrichment jobs (let them complete)

#### Risk: No Dead Letter Queue
**Scenario:** Enrichment job fails 5 times (network errors) → pg_boss gives up → lead stuck in limbo.

**Mitigation:**
- ✅ Implement dead letter queue: failed jobs moved to `commercial_intelligence_queue_dead_letter`
- ✅ Manual retry button: admin can re-enqueue from DLQ
- ✅ Alert: if any jobs in DLQ for > 1 day

---

## 8. Implementation Roadmap

### Phase 1: Foundation (Week 1–2)
**Goal:** Schema changes, job queue setup, basic enrichment

**Tasks:**
1. ✅ Add columns to leads table (migration):
   ```sql
   ALTER TABLE leads ADD COLUMN website_snapshot JSONB;
   ALTER TABLE leads ADD COLUMN business_signals JSONB;
   ALTER TABLE leads ADD COLUMN commercial_profile JSONB;
   ALTER TABLE leads ADD COLUMN enrichment_completed_at TIMESTAMP;
   ALTER TABLE leads ADD COLUMN enrichment_last_error TEXT;
   ```

2. ✅ Set up pg_boss (or chosen queue system):
   ```bash
   npm install pg-boss
   # OR: Enable Supabase pg_boss extension
   ```

3. ✅ Create PostgreSQL trigger (enqueue on lead insert):
   ```sql
   CREATE OR REPLACE FUNCTION enqueue_commercial_intelligence()
   RETURNS TRIGGER AS $$
   BEGIN
     PERFORM pgboss.schedule(
       jobname := 'enrich-commercial-intelligence',
       data := jsonb_build_object(
         'lead_id', NEW.id,
         'user_id', NEW.user_id,
         'website', NEW.website,
         'company_name', NEW.company_name
       ),
       priority := 100
     );
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

4. ✅ Implement application-level job handler:
   ```typescript
   // app/jobs/enrich-commercial-intelligence.ts
   // - Fetches Website Snapshot
   // - Fetches Business Signals
   // - Fetches Commercial Profile
   // - Updates leads table
   // - Handles errors (retry logic)
   ```

5. ✅ Test with mock Commercial Intelligence data (no real API calls):
   ```typescript
   // lib/commercial-intelligence/mock.ts
   // Returns placeholder data for development
   ```

6. ✅ Add rate limiting (max 100 enrichments/day):
   ```typescript
   // Middleware or job handler checks daily quota
   ```

**Metrics:**
- Schema migration time: < 5 minutes
- Job handler latency: < 2 seconds per lead
- Queue depth after 1000-lead discovery: < 100 pending (healthy)

---

### Phase 2: Observability & Testing (Week 3)
**Goal:** Monitor enrichment pipeline, validate data quality, admin testing UI

**Tasks:**
1. ✅ Add monitoring metrics:
   ```typescript
   // Track job queue depth, latency, error rate
   // Instrument API calls (Website Snapshot, Business Signals, Commercial Profile)
   ```

2. ✅ Create admin testing UI:
   - `/admin/commercial-intelligence-test`
   - Select leads, enrich, view results
   - Debug failed enrichments
   - Cost calculator

3. ✅ Validate enriched data:
   - Spot-check 10 random leads
   - Verify Website Snapshot is valid
   - Verify Business Signals (employee count, etc.)
   - Verify Commercial Profile (decision makers, etc.)

4. ✅ Error handling:
   - Classify errors (API timeout, invalid response, rate limit)
   - Implement backoff strategy
   - Dead letter queue for failed jobs

**Metrics:**
- Enrichment success rate: > 95%
- Average enrichment latency: < 5 seconds per lead
- Job failure rate: < 1%

---

### Phase 3: Real API Integration (Week 4)
**Goal:** Connect to actual Commercial Intelligence APIs, optimize cost

**Tasks:**
1. ✅ Implement Website Snapshot API client:
   ```typescript
   // lib/commercial-intelligence/website-snapshot.ts
   // - Fetch website metadata, tech stack, etc.
   // - Cache for 24 hours (deduplication)
   // - Cost tracking
   ```

2. ✅ Implement Business Signals API client:
   ```typescript
   // lib/commercial-intelligence/business-signals.ts
   // - Founded date, employee count, revenue, funding
   // - Cache for 7 days
   // - Cost tracking
   ```

3. ✅ Implement Commercial Profile API client:
   ```typescript
   // lib/commercial-intelligence/commercial-profile.ts
   // - Decision makers, org structure, buying signals
   // - Cache for 14 days
   // - Cost tracking
   ```

4. ✅ Deduplication at enrichment time:
   ```typescript
   // Check if website enriched in last 24h
   // Skip redundant API calls
   ```

5. ✅ Cost budgeting:
   - Team quota: $50/month (configurable)
   - Track per-team usage in real-time
   - Alert at 80%, block at 100%

**Metrics:**
- API call latency: < 3 seconds per API (p95)
- Deduplication rate: > 30% (expected, multiple contacts/company)
- Cost per lead: ~$0.20 (3 APIs @ $0.05–0.10 each)

---

### Phase 4: Product Integration (Week 5)
**Goal:** Surface Commercial Intelligence in UI, make discoverable to users

**Tasks:**
1. ✅ Update My Leads workspace:
   - Show enrichment status (pending/completed)
   - Display Website Snapshot (tech stack)
   - Display Business Signals (size, revenue)
   - Display Commercial Profile (decision makers, buying signals)
   - (Can be collapsed section or side panel)

2. ✅ Update discovery results:
   - Show which leads are enriched
   - Link to refresh enrichment

3. ✅ Update lead detail view:
   - Full Commercial Intelligence data
   - "Last enriched" timestamp
   - "Refresh enrichment" button

4. ✅ Add enrichment cost display:
   - Per-user dashboard: "Commercial Intelligence Budget"
   - Show remaining balance
   - Show trend (how much spent this month)

**Metrics:**
- UI load time impact: < 200ms (enrichment data lazy-loaded)
- User engagement: track clicks on Commercial Intelligence sections

---

### Phase 5: Launch & Monitoring (Week 6+)
**Goal:** Gradual rollout, gather feedback, optimize

**Tasks:**
1. ✅ Beta rollout:
   - Internal team only (first week)
   - 10% of users (second week)
   - 50% of users (third week)
   - 100% (week 4)

2. ✅ Monitor during rollout:
   - Job queue health
   - API success rates
   - Cost trend
   - User feedback

3. ✅ Optimize based on feedback:
   - Adjust caching strategy if needed
   - Refine deduplication logic
   - Add missing Commercial Intelligence fields

4. ✅ Plan for scale:
   - If cost exceeds budget: implement quota system
   - If job queue backs up: add more workers
   - If API rate-limited: implement queuing/backoff

---

## 9. Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    ALPA DISCOVERY ARCHITECTURE                  │
│                   (+ Commercial Intelligence)                   │
└─────────────────────────────────────────────────────────────────┘

USER INITIATES DISCOVERY
          │
          ├─→ /dashboard/scraper/page.tsx
          │   (UI component, shows progress in real-time)
          │
          ▼
    POST /api/scrape
    {
      query: "...",
      defaultCity: "...",
      maxLeads: 50
    }
          │
          ▼
    ┌─────────────────────────────────────────────────┐
    │  POST Handler: /app/api/scrape/route.ts         │
    │  (Line 1124)                                     │
    │                                                  │
    │  1. Validate authentication                      │
    │  2. Resolve subscription plan & lead limit      │
    │  3. Create ReadableStream (SSE)                  │
    │  4. Invoke runScraper()                          │
    └─────────────────────────────────────────────────┘
          │
          ▼
    ┌──────────────────────────────────────────────────────────┐
    │  runScraper() in /app/api/scrape/route.ts               │
    │  (Line 981)                                              │
    │                                                          │
    │  Orchestrates discovery + persistence                    │
    └──────────────────────────────────────────────────────────┘
          │
          ├─→ runSharedProspectorDiscovery() [/lib/scraper/run-scraper-shared.ts:670]
          │   │
          │   ├─→ PHASE 1: Serper Discovery
          │   │   │
          │   │   ├─→ searchSerperMaps()
          │   │   │   (External API: $0.01/call)
          │   │   │
          │   │   ├─→ For each result:
          │   │   │   upsertDiscoveredLead() [in-memory dedup by website/phone/name]
          │   │   │   send("📥 Company Name")
          │   │   │
          │   │   └─→ discoveredLeads[] accumulates
          │   │
          │   ├─→ PHASE 2: Email Enrichment (Parallel)
          │   │   │
          │   │   ├─→ enrichLeadQueue()
          │   │   │   │
          │   │   │   ├─→ 4 parallel workers drain shared queue
          │   │   │   │
          │   │   │   ├─→ For each lead:
          │   │   │   │   fetchHtml(website) → extract emails via regex
          │   │   │   │   Try secondary pages: /contact, /about, /team
          │   │   │   │   send("✨ Company Name")
          │   │   │   │
          │   │   │   └─→ Enrichment complete
          │   │   │       (email, email_confidence, is_generic_email populated)
          │   │   │
          │   │   └─→ finalEnrichedLeads[] ready for DB
          │   │
          │   ├─→ PHASE 3: Google Improvement (Conditional)
          │   │   if (!meetsQualityTargets) {
          │   │     searchGooglePlaces() (External API: $0.03/call)
          │   │     upsertDiscoveredLead() [merge with Serper results]
          │   │     enrichLeadQueue() [re-enrich weak leads]
          │   │   }
          │   │
          │   └─→ Return finalEnrichedLeads[]
          │
          ├─→ saveLead() for each enriched lead [Line 824]
          │   │
          │   ├─→ Build LeadInsertPayload
          │   │   {
          │   │     user_id, company_name, email, phone, website,
          │   │     status: 'inbox', source, email_confidence, cost_estimate
          │   │   }
          │   │
          │   ├─→ INSERT into leads table
          │   │   (Unique constraint: (user_id, email), (user_id, phone), (user_id, website))
          │   │
          │   ├─→ If duplicate:
          │   │   PostgreSQL error 23505 → classify as 'duplicate'
          │   │   send("⚠️ duplicate skipped")
          │   │
          │   └─→ On success:
          │       emit({ type: 'lead', payload: { id, ... } })
          │
          └─→ Emit final result via SSE
              {
                type: 'result',
                payload: {
                  summaryLine: "50 leads ready to contact",
                  addedCount: 45,
                  discoveredCount: 50,
                  enrichedCount: 48,
                  leads_used: 85,
                  leads_limit: 100
                }
              }

    Stream closes. Discovery complete.

┌──────────────────────────────────────────────────────────────────────┐
│  ✨ NEW: COMMERCIAL INTELLIGENCE ENRICHMENT (Asynchronous)           │
│                                                                       │
│  PostgreSQL Trigger fires on INSERT (automatic):                      │
│                                                                       │
│  FOR EACH inserted lead {                                             │
│    INSERT INTO pg_boss.job {                                          │
│      name: 'enrich-commercial-intelligence',                          │
│      data: { lead_id, user_id, website, company_name }               │
│    }                                                                   │
│  }                                                                     │
│                                                                       │
│  Background workers (separate from discovery):                        │
│    while (jobs_pending) {                                             │
│      job = pg_boss.fetch_job()                                        │
│                                                                       │
│      1. Fetch Website Snapshot (cached 24h)                           │
│      2. Fetch Business Signals (cached 7d)                            │
│      3. Fetch Commercial Profile (cached 14d)                         │
│                                                                       │
│      UPDATE leads SET                                                 │
│        website_snapshot = {...},                                      │
│        business_signals = {...},                                      │
│        commercial_profile = {...},                                    │
│        enrichment_completed_at = now()                                │
│      WHERE id = lead_id                                               │
│                                                                       │
│      pg_boss.complete_job(job_id)                                     │
│    }                                                                   │
└──────────────────────────────────────────────────────────────────────┘

USER SEES RESULTS
    │
    ├─→ Discovery UI: "50 leads discovered, 48 enriched"
    │
    └─→ My Leads Workspace:
        ├─→ 45 new leads in inbox
        ├─→ Commercial Intelligence enriching in background
        │   (📊 Website Snapshot, 🎯 Business Signals, 💼 Commercial Profile)
        │
        └─→ As enrichment completes:
            └─→ Lead detail panel auto-updates with Commercial Intelligence data
```

---

## 10. Summary: What's Safe to Change (Phase 1)

**Safe to add:**
- ✅ New columns on leads table (website_snapshot, business_signals, commercial_profile)
- ✅ PostgreSQL trigger for job enqueueing
- ✅ Job queue system (pg_boss or BullMQ)
- ✅ Background job handler for Commercial Intelligence APIs

**NOT safe to change (preserve existing behavior):**
- ❌ Discovery flow (Serper → Google → enrichment pipeline)
- ❌ Email enrichment (4 parallel workers, in-memory dedup)
- ❌ Lead persistence (saveLead → PostgreSQL insert)
- ❌ Unique constraints on leads table
- ❌ SSE streaming to frontend

**Result:** Commercial Intelligence slots in as async background work. Discovery latency = 0 impact. Discovery UI unchanged. User sees leads immediately; enrichment populates later.

---

## Conclusion

ALPA's discovery architecture is **sound and scalable**. The SSE streaming + 4-worker enrichment design prioritizes user experience (real-time feedback) without sacrificing completeness.

**Commercial Intelligence integration is straightforward:**
1. Add schema columns (non-breaking)
2. Enqueue jobs asynchronously (trigger-based)
3. Background workers enrich leads without impacting discovery
4. Canonical entity = `leads` table (no migration needed)

**Risk is low** because:
- Discovery pipeline untouched
- Enrichment is independent (can fail without affecting discovered leads)
- Cost is tracked and budgeted upfront
- Can start with mock data, migrate to real APIs later

**Next steps:** Implementation phase 1 (schema + job queue) can begin immediately.

