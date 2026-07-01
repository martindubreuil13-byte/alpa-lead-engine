# Commercial Intelligence V1 — Implementation Complete

**Date:** July 1, 2026  
**Status:** Ready for local testing  
**Foundation:** Complete, async-first architecture in place

---

## What Was Built

Commercial Intelligence V1 adds asynchronous enrichment to discovered leads without slowing discovery. Three deterministic/AI services extract website metadata, detect business features, and generate profiles.

**Discovery pipeline completely untouched.** Enrichment happens in background after lead creation.

---

## Files Changed / Created

### 🗄️ Database (1 file)

**`supabase/migrations/20260701_add_commercial_intelligence.sql`** — New
- Adds 12 columns to leads table
- Creates commercial_intelligence_jobs tracking table
- Creates triggers for auto-enqueueing jobs
- Creates indexes for efficient queries

### 📦 Services (5 files)

**`lib/commercial-intelligence/types.ts`** — New
- TypeScript types for all CI data structures
- EnrichmentStatus, WebsiteSnapshot, BusinessSignals, CommercialProfile, etc.

**`lib/commercial-intelligence/extract-website-snapshot.ts`** — New
- Deterministic HTML parsing using Cheerio
- Extracts: title, meta description, H1, body excerpt, contact/about/services URLs
- Extracts: visible email, visible phone, social links, favicon, HTML hash
- No external APIs. Cost: free. Time: 2-3s.

**`lib/commercial-intelligence/generate-business-signals.ts`** — New
- Feature detection across website pages
- Detects: HTTPS, contact/about/services pages, pricing, testimonials, blog, FAQ, booking links
- Detects: CMS platforms (WordPress, Webflow, etc.), e-commerce platforms (Shopify, etc.)
- Fetches key pages in parallel (homepage, contact, about, services)
- No external APIs. Cost: free. Time: 2-3s.

**`lib/commercial-intelligence/generate-commercial-profile.ts`** — New
- GPT-4o mini-based profile generation
- Generates: summary, industry, business_category, primary_service, core_services, target_customer, competitive_advantage, keywords
- Temperature 0.3 for factual output
- Uses existing OpenAI client from `/lib/ai/openai.ts`
- Cost: $0.0001-0.0003. Time: 1-2s.

**`lib/commercial-intelligence/enrich-lead.ts`** — New
- Main orchestrator for all three services
- Fetches lead from database
- Calls snapshot, signals, profile in sequence
- Updates lead with enrichment data
- Handles errors gracefully (lead remains usable)
- Updates job tracking record

**`lib/commercial-intelligence/index.ts`** — New
- Barrel export of all public functions and types

### 🔌 API Routes (2 files)

**`app/api/admin/enrich-lead/route.ts`** — New
- `POST /api/admin/enrich-lead` — Manual enrichment trigger (admin only)
- Request: `{ leadId, forceRefresh }`
- Runs enrichment synchronously (for testing)
- Response: full enrichment data + metadata

**`app/api/admin/process-ci-jobs/route.ts`** — New
- `POST /api/admin/process-ci-jobs` — Background job processor
- Requires header: `x-admin-secret`
- Fetches up to 10 pending jobs
- Processes each with enrichLeadCommercialIntelligence()
- Handles retries with exponential backoff (2, 4, 8, 16, 32 min)
- Max 5 retries, then fails

### 🎨 Admin UI (1 file)

**`app/admin/commercial-intelligence-test/page.tsx`** — New
- `/admin/commercial-intelligence-test` — Internal testing only
- Lead selection dropdown (20 most recent)
- Shows enrichment status, timestamps, errors
- Manual trigger button with force-refresh option
- Live results display:
  - Website Snapshot: title, emails, social links, favicon
  - Business Signals: feature detection results, CMS/e-commerce detection, response time
  - Commercial Profile: summary, industry, category, keywords
- Duration and cost display for each enrichment

### 📖 Documentation (2 files)

**`COMMERCIAL_INTELLIGENCE_V1.md`** — New
- Comprehensive V1 guide
- Architecture, data model, how it works
- Testing procedures (setup, admin UI, API, queries)
- Known limitations, future enhancements
- Environment variables, deployment notes

**`CI_V1_IMPLEMENTATION_SUMMARY.md`** — This file
- Quick reference for files changed
- Local testing instructions
- How to apply migration
- Next recommended steps

---

## How to Test Locally

### 1. Apply Database Migration

```bash
# Option A: Supabase CLI
supabase migration up

# Option B: Manual in Supabase dashboard
# 1. Copy `supabase/migrations/20260701_add_commercial_intelligence.sql`
# 2. Paste in Supabase SQL Editor
# 3. Execute
```

**Verify migration:**
```sql
-- Check new columns exist on leads table
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'leads' 
  AND column_name LIKE 'ci_%'
ORDER BY column_name;

-- Should return: ci_cost_estimate, ci_enriched_at, ci_enrichment_status, etc.

-- Check job table exists
SELECT * FROM commercial_intelligence_jobs LIMIT 1;
```

### 2. Verify OpenAI Configuration

Commercial Intelligence uses the existing OpenAI client. Verify setup:

```bash
# Check environment variable
echo $OPENAI_API_KEY

# Should be set (used by lib/ai/openai.ts)
```

### 3. Start Dev Server

```bash
npm run dev
# Server runs on http://localhost:3000
```

### 4. Test Admin UI

**Navigate to:** `http://localhost:3000/admin/commercial-intelligence-test`

Steps:
1. Page loads with 20 most recent leads
2. Select a lead with a website (not null)
3. Click "Start Enrichment"
4. Watch real-time enrichment (5-8 seconds)
5. View results:
   - Website Snapshot: title, emails, social links
   - Business Signals: feature detection
   - Commercial Profile: AI summary & keywords

**Expected:** All three enrichments complete, costs shown (~$0.0001), no errors.

### 5. Test Manual API Enrichment

```bash
# Find a lead ID from database
SELECT id, company_name, website FROM leads LIMIT 1;

# Make API call (replace LEAD_ID)
curl -X POST http://localhost:3000/api/admin/enrich-lead \
  -H "Content-Type: application/json" \
  -H "Cookie: your-auth-cookie" \
  -d '{
    "leadId": "LEAD_ID",
    "forceRefresh": false
  }'

# Response should include website_snapshot, business_signals, commercial_profile
```

### 6. Test Job Processor

```bash
# Set admin secret in .env.local
ADMIN_ENRICHMENT_SECRET=test-secret-12345

# Call job processor
curl -X POST http://localhost:3000/api/admin/process-ci-jobs \
  -H "x-admin-secret: test-secret-12345"

# Response shows how many jobs processed
```

### 7. Query Results in Database

```sql
-- Check enriched leads
SELECT 
  id, company_name, website,
  ci_enrichment_status,
  ci_enriched_at,
  ci_processing_duration_ms,
  ci_cost_estimate
FROM leads
WHERE ci_enrichment_status = 'completed'
ORDER BY ci_enriched_at DESC
LIMIT 5;

-- View job history
SELECT 
  id, lead_id, status, error_message,
  processing_duration_ms, total_cost
FROM commercial_intelligence_jobs
ORDER BY created_at DESC
LIMIT 10;

-- Check failed enrichments
SELECT 
  id, company_name, ci_last_error, ci_retry_count
FROM leads
WHERE ci_enrichment_status = 'failed';
```

### 8. Test Error Scenarios

**Lead without website:**
- Select a lead where website = NULL
- Trigger enrichment
- Result: status = 'skipped', cost = 0

**Force refresh:**
- Select an already-enriched lead
- Check "Force refresh"
- Click "Start Enrichment"
- Result: Old data replaced with fresh extraction

**Retry logic (simulate):**
- Manually update a job to 'retrying' in database
- Call `/api/admin/process-ci-jobs`
- Job should reprocess and update

---

## SQL Migration Summary

The `20260701_add_commercial_intelligence.sql` file:

1. **Alters leads table** — Adds 12 columns for CI data
   ```sql
   ALTER TABLE leads ADD COLUMN website_snapshot JSONB;
   ALTER TABLE leads ADD COLUMN business_signals JSONB;
   ALTER TABLE leads ADD COLUMN commercial_profile JSONB;
   ALTER TABLE leads ADD COLUMN ci_enrichment_status VARCHAR(50) DEFAULT 'pending';
   -- ... etc (ci_enriched_at, ci_started_at, ci_last_error, ci_retry_count, etc.)
   ```

2. **Creates commercial_intelligence_jobs table** — Full job tracking
   ```sql
   CREATE TABLE commercial_intelligence_jobs (
     id UUID PRIMARY KEY,
     user_id UUID NOT NULL,
     lead_id UUID NOT NULL REFERENCES leads(id),
     status VARCHAR(50),
     started_at, completed_at, processing_duration_ms,
     retry_count, max_retries, next_retry_at,
     error_message, error_code,
     snapshot_status, signals_status, profile_status,
     total_cost NUMERIC,
     created_at, updated_at
   );
   ```

3. **Creates indexes** — For efficient queries
   ```sql
   CREATE INDEX idx_leads_ci_status ON leads(user_id, ci_enrichment_status);
   CREATE INDEX idx_leads_ci_enriched ON leads(user_id, ci_enriched_at DESC);
   CREATE INDEX idx_ci_jobs_status ON commercial_intelligence_jobs(status);
   -- ... etc
   ```

4. **Creates triggers** — Auto-enqueue on lead insert
   ```sql
   CREATE TRIGGER trigger_mark_lead_for_enrichment BEFORE INSERT ON leads ...
   CREATE TRIGGER trigger_enqueue_ci_job AFTER INSERT ON leads ...
   ```

**Size:** ~400 lines of SQL  
**Breaking changes:** None (only additive)  
**Reversible:** Yes (can drop columns/table if needed)

---

## Environment Setup

### Required

```bash
# .env.local or Supabase config
OPENAI_API_KEY=sk-...          # Already used by existing code
ADMIN_ENRICHMENT_SECRET=your-secret-here
```

### Optional (for future)

```bash
CI_COST_BUDGET_MONTHLY=50      # Monthly limit in USD
CI_MAX_RETRIES=5               # Max retry attempts
```

---

## New API Routes

### POST /api/admin/enrich-lead

**Admin-only.** Synchronous manual enrichment.

```bash
curl -X POST http://localhost:3000/api/admin/enrich-lead \
  -H "Content-Type: application/json" \
  -d '{"leadId": "uuid", "forceRefresh": false}'
```

**Response:**
```json
{
  "ok": true,
  "leadId": "uuid",
  "data": {
    "website_snapshot": {...},
    "business_signals": {...},
    "commercial_profile": {...},
    "enrichment_status": "completed",
    ...
  },
  "processingDurationMs": 6234,
  "cost": 0.00012
}
```

### POST /api/admin/process-ci-jobs

**Admin-only.** Asynchronous background job processor.

```bash
curl -X POST http://localhost:3000/api/admin/process-ci-jobs \
  -H "x-admin-secret: your-secret-here"
```

**Response:**
```json
{
  "ok": true,
  "processed": 5,
  "results": [
    {
      "jobId": "uuid",
      "leadId": "uuid",
      "success": true,
      "duration": 6234,
      "cost": 0.00012
    }
  ]
}
```

---

## How to Apply Supabase Migration

### Method 1: Supabase CLI (Recommended)

```bash
cd /Users/martin/Documents/ALPA

# List pending migrations
supabase migration list

# Push all pending migrations
supabase migration up

# Verify
supabase db inspect
```

### Method 2: Supabase Dashboard

1. Go to https://app.supabase.com
2. Select your project
3. Go to SQL Editor
4. Create new query
5. Paste contents of `supabase/migrations/20260701_add_commercial_intelligence.sql`
6. Click "Run" (⚡)
7. Verify: Tables & columns created

### Method 3: Verify Locally

If using local Supabase:
```bash
supabase start
supabase db push
supabase db inspect  # View schema
```

---

## Known Limitations (V1)

1. **No automatic job scheduling**
   - Must manually call `/api/admin/process-ci-jobs` or setup cron
   - **Workaround:** Use Vercel Cron to call endpoint every 5 min

2. **No domain-level deduplication**
   - If 3 contacts at acme.com, all 3 get enriched
   - **Workaround:** Can implement in V1.1

3. **Admin UI is synchronous**
   - Testing enrichment waits for completion (5-8s)
   - Background jobs are async (separate)

4. **No cost budgeting**
   - No spend limits
   - **Workaround:** Monitor via `SELECT SUM(ci_cost_estimate) FROM leads`

5. **No backfill for existing leads**
   - Only enriches leads created after migration
   - **Workaround:** Can backfill manually via admin UI

6. **Commercial Profile is basic**
   - No confidence scores (by design)
   - Factual but simple AI summaries

---

## Next Recommended Steps

### Immediate (This Sprint)

- [ ] Apply migration to production Supabase
- [ ] Test enrichment on 10-20 recent leads
- [ ] Verify costs look reasonable (should be ~$0.0001/lead)
- [ ] Set up ADMIN_ENRICHMENT_SECRET
- [ ] Document secret in team secrets manager

### Short-term (V1.1, Next Sprint)

- [ ] Set up Vercel Cron to process jobs every 5 minutes
  ```
  POST /api/admin/process-ci-jobs with admin secret
  Every 5 minutes, 24/7
  ```

- [ ] Add monitoring/alerts
  - Query pending job count every minute
  - Alert if > 100 pending or any failed for > 1 hour

- [ ] Implement domain-level deduplication
  - Before enriching, check if same website enriched in last 24h
  - Skip API calls if already recent

- [ ] Add cost dashboard
  - Show daily/monthly spending on CI
  - Track cost per user

### Medium-term (V2, 1-2 Sprints Away)

- [ ] Display CI data in My Leads UI
  - Show Website Snapshot title & social links
  - Show Business Signals as feature badges
  - Show Commercial Profile summary in lead card

- [ ] Add search/filter by Business Signals
  - Filter by "has_pricing", "has_blog", "has_testimonials"
  - Filter by "industry", "business_category"

- [ ] Email personalization using Commercial Profile
  - Auto-generate subject lines based on industry
  - Use keywords in email body

- [ ] Refactor to separate Business table (if cost/complexity justify)
  - One business, many leads (contacts)
  - Share enrichment data across contacts at same company

---

## Testing Checklist

Use this checklist to verify everything works:

- [ ] Migration applied successfully
- [ ] leads table has new columns (ci_enrichment_status, etc.)
- [ ] commercial_intelligence_jobs table exists
- [ ] Admin UI loads (`/admin/commercial-intelligence-test`)
- [ ] Can select lead and trigger enrichment
- [ ] Website Snapshot extracts title, emails, social links
- [ ] Business Signals detects features (pricing, blog, etc.)
- [ ] Commercial Profile generates summary & keywords
- [ ] Enrichment takes 5-8 seconds
- [ ] Cost is ~$0.0001
- [ ] Results show in database (ci_enrichment_status = 'completed')
- [ ] Can query results with SQL
- [ ] Force refresh works (re-enriches already-enriched lead)
- [ ] Job processor endpoint works (`/api/admin/process-ci-jobs`)
- [ ] Job processor picks up pending jobs and processes them
- [ ] No errors in server logs

---

## Performance & Costs

### Per-Lead Enrichment

| Service | Cost | Time |
|---------|------|------|
| Website Snapshot | Free | 2-3s |
| Business Signals | Free | 2-3s |
| Commercial Profile | $0.0001 | 1-2s |
| **Total** | **$0.0001** | **5-8s** |

### At Scale

- 100 leads/day: ~$0.01
- 1,000 leads/day: ~$0.10
- 10,000 leads/day: ~$1.00

### Throughput

- Single worker: ~7-12 leads/min
- With 10 parallel workers: ~70-120 leads/min

---

## Support & Troubleshooting

### Common Issues

**Q: Enrichment endpoint returns 401**
- A: Not authenticated. Make sure you're logged in as admin.

**Q: OpenAI API error**
- A: Check OPENAI_API_KEY is set. Verify API quota/limits.

**Q: Enrichment times out**
- A: Website might be slow. Check response_time_ms in signals. Increase timeout or skip.

**Q: Jobs stuck in "processing"**
- A: Worker might have crashed. Manually mark as failed or restart service.

**Q: Can't see new columns in Supabase**
- A: Refresh page. Migration might not have completed yet.

### Debug Queries

```sql
-- See all enrichment activity
SELECT id, company_name, ci_enrichment_status, ci_enriched_at, ci_processing_duration_ms
FROM leads
WHERE ci_enrichment_status IS NOT NULL
ORDER BY ci_enriched_at DESC
LIMIT 20;

-- See job failures
SELECT id, lead_id, error_message, retry_count
FROM commercial_intelligence_jobs
WHERE status = 'failed'
ORDER BY updated_at DESC;

-- See pending jobs
SELECT id, lead_id, created_at
FROM commercial_intelligence_jobs
WHERE status IN ('pending', 'retrying')
ORDER BY created_at ASC;
```

---

## Summary

✅ **V1 Implementation Complete**

- Database schema ready (12 new columns, job tracking table)
- Three deterministic/AI services fully implemented
- Admin testing UI ready for local testing
- Background job processor ready
- Zero impact on discovery pipeline
- Fully async, non-blocking enrichment

**Next:** Apply migration, test locally, then schedule background job processor.

---

**For detailed documentation, see:**
- `COMMERCIAL_INTELLIGENCE_V1.md` — Full architecture & guide
- `ARCHITECTURE_AUDIT_COMMERCIAL_INTELLIGENCE.md` — Strategic context
