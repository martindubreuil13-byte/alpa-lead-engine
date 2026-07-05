# Commercial Intelligence Queue — Production Architecture

## Overview

The Commercial Intelligence enrichment is powered by a durable Supabase-backed queue. On Vercel Hobby, authenticated discovery requests enqueue leads, return discovered leads, and then trigger a bounded queue drain with Next.js `after()`.

```
Lead Discovery
    ↓
Lead Saved to Database ✓
    ↓
Queue Record Inserted ✓
    ↓
Response Returned to User ✓
    ↓
Shared Queue Processor Runs
    ↓
Worker Retrieves Pending Items
    ↓
enrichLeadDirect(leadId) — Canonical Engine
    ↓
Lead Updated with CI Data
    ↓
Queue Record Marked Completed
```

## Architecture

### The Enrichment Engine (Unchanged)

**File**: `lib/commercial-intelligence/enrich-lead-direct.ts`

- Takes a `leadId` and returns enrichment results
- Runs all 3 stages: Snapshot → Signals → Profile
- Updates lead in Supabase
- Has NO knowledge of the queue
- Can be called from anywhere:
  - Manual refresh (synchronous)
  - Queue worker (via queue)
  - Bulk enrichment (parallel)
  - Scheduled jobs (future)

**Key principle**: The enrichment engine is completely independent. It never imports or references the queue.

### The Queue Layer

**File**: `lib/commercial-intelligence/queue-manager.ts`

Functions:
- `enqueueLeadEnrichment(leadId)` — Insert queue record
- `claimPendingQueueItems(limit)` — Atomically claim pending items
- `resetStaleProcessingItems(timeoutSeconds)` — Recover stale processing items
- `completeEnrichment(queueId, ...)` — Atomically update queue + lead
- `getQueueStats()` — Monitoring helper

**Key principle**: The queue only manages persistence and status. It never calls the enrichment engine directly.

### The Shared Processor

**File**: `lib/commercial-intelligence/process-queue.ts`

- Calls queue claim/recovery helpers
- Calls `enrichLeadDirect(leadId)` for claimed jobs
- Calls `completeEnrichment()` to update the queue and lead
- Used by both authenticated discovery requests and the admin worker route

### The Worker Route

**File**: `app/api/admin/ci-queue-worker/route.ts`

- **Endpoint**: `POST /api/admin/ci-queue-worker` (admin-only)
- **Max duration**: 5 minutes (configurable)
- **Flow**: calls `processCommercialIntelligenceQueue({ limit: 10 })`

**Key principle**: The worker is a simple dispatcher. All enrichment logic stays in `enrichLeadDirect()`.

## Database Schema

```sql
CREATE TABLE commercial_intelligence_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT
);
```

**Statuses**: `pending` → `processing` → `completed` or `failed`

**Indexes**:
- `idx_ci_queue_status` — Fast lookup of pending/processing items
- `idx_ci_queue_lead_id` — Link to leads
- `idx_ci_queue_created_at` — Sorted by age

## Workflows

### 1. Lead Discovery (Automatic)

```
Discovery Search
  ↓
leads discovered and validated
  ↓
saveLead() for each lead
  ↓
If successful:
  ↓
  enqueueLeadEnrichment(leadId)
    └─ INSERT into commercial_intelligence_queue
       status='pending'
  ↓
Response returned
  ↓
after(): drainCommercialIntelligenceQueue({ batchLimit: 5, maxBatches: 5 })
```

**User experience**:
- Search results are returned immediately after discovery/enqueue
- Queue processing starts after the response path completes
- Queue draining is capped at 5 batches of 5 items, or 55 seconds
- Queue failures are logged and do not fail discovery

### 2. Manual Refresh

```
User clicks "Refresh Commercial Intelligence"
  ↓
Call enrichLeadDirect(leadId) directly
  ↓
Synchronous, immediate response
  ↓
Lead updated, UI shows results
```

**User experience**:
- Immediate feedback (user expects to wait)
- No queue involved
- Same engine as automatic enrichment

### 3. Queue Processing

```
Worker started by scrape request or manual admin POST:
  processCommercialIntelligenceQueue(limit)
  ↓
Reset stale processing items
  ↓
Claim pending items
  ↓
For each item:
  ├─ Mark as 'processing'
  ├─ Call enrichLeadDirect(leadId)
  ├─ If success:
  │   └─ Mark as 'completed'
  └─ If failure:
      ├─ If retry_count < 2:
      │   └─ Mark as 'pending' (will retry)
      └─ Else:
          └─ Mark as 'failed'
```

**Reliability**:
- Queue records persisted before enrichment starts
- Automatic retry on failure (up to 2 retries)
- Failures don't block other items
- Worker can be interrupted and restarted safely

## Monitoring

### Check Queue Status

```sql
-- Count items by status
SELECT 
  status, 
  COUNT(*) as count 
FROM commercial_intelligence_queue 
GROUP BY status;

-- See pending items
SELECT 
  id, 
  lead_id, 
  created_at, 
  retry_count 
FROM commercial_intelligence_queue 
WHERE status = 'pending' 
ORDER BY created_at ASC;

-- See failed items
SELECT 
  id, 
  lead_id, 
  last_error, 
  retry_count, 
  completed_at 
FROM commercial_intelligence_queue 
WHERE status = 'failed' 
ORDER BY completed_at DESC 
LIMIT 20;

-- See processing items (stuck?)
SELECT 
  id, 
  lead_id, 
  started_at, 
  (now() - started_at) as duration 
FROM commercial_intelligence_queue 
WHERE status = 'processing' 
ORDER BY started_at ASC;
```

### Via API

```bash
# Get queue stats
curl -X GET https://your-api.com/api/admin/ci-queue-worker \
  -H "Authorization: Bearer YOUR_TOKEN"

# Process queue manually
curl -X POST https://your-api.com/api/admin/ci-queue-worker \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Request-Bound Queue Processing

Production queue processing does not depend on Vercel Cron. After authenticated discovery finishes saving, enqueueing leads, and emitting the scrape result, the route schedules `drainCommercialIntelligenceQueue({ batchLimit: 5, maxBatches: 5, maxRuntimeMs: 55000 })` with Next.js `after()`.

Manual local test with authenticated admin cookies/session:

```bash
curl -X POST http://localhost:3000/api/admin/ci-queue-worker
```

Verify queue movement in Supabase:

```sql
SELECT status, COUNT(*)
FROM commercial_intelligence_queue
GROUP BY status
ORDER BY status;

SELECT id, lead_id, status, started_at, completed_at, last_error
FROM commercial_intelligence_queue
ORDER BY created_at DESC
LIMIT 20;
```

## Production Setup

### One-Time Setup

1. **Apply migration**:
   ```sql
   -- Run in Supabase SQL Editor
   -- From: supabase/migrations/20260704_add_commercial_intelligence_queue.sql
   ```

2. **Verify table created**:
   ```sql
   SELECT * FROM commercial_intelligence_queue LIMIT 1;
   ```

### Ongoing Operations

#### Automatic Processing

Authenticated discovery requests enqueue leads and then schedule a bounded drain after the final result has been emitted. The drain calls the shared queue processor in batches, so processing still uses `reset_stale_ci_processing()`, `claim_ci_queue_items()`, and `complete_ci_enrichment()`.

#### Manual Trigger

Admins can still process the queue manually with `POST /api/admin/ci-queue-worker`.

## Code Reuse

The queue is designed for extensibility. All of these can use the same queue and enrichment engine:

### Bulk Enrichment

```typescript
async function bulkEnrichLeads(leadIds: string[]) {
  for (const leadId of leadIds) {
    await enqueueLeadEnrichment(leadId)
  }
}
```

### Scheduled Refresh (Stale Profiles)

```typescript
async function refreshStaleProfiles() {
  // Find leads with old CI data
  const staleLeads = await supabase
    .from('leads')
    .select('id')
    .where('ci_completed_at < now() - interval 7 days')

  for (const lead of staleLeads) {
    await enqueueLeadEnrichment(lead.id)
  }
}
```

### Legacy Lead Enrichment

```typescript
async function enrichLegacyLeads() {
  const unenrichedLeads = await supabase
    .from('leads')
    .select('id')
    .where('ci_enrichment_status IS NULL')

  for (const lead of unenrichedLeads) {
    await enqueueLeadEnrichment(lead.id)
  }
}
```

All use the same queue and `enrichLeadDirect()` engine.

## Guarantees

✅ **Lead is saved before enrichment starts** — Immediate discovery response  
✅ **Queue record persisted before enrichment** — Guaranteed processing  
✅ **Enrichment engine independent** — Reusable everywhere  
✅ **Automatic retry on failure** — Up to 2 retries  
✅ **Error tracking** — Last error stored in queue  
✅ **No data loss** — Queue records persist indefinitely  
✅ **Idempotent** — Safe to retry any item  
✅ **Serverless safe** — No unawaited promises  
✅ **Scalable** — Process multiple items per run  
✅ **Extensible** — Supports future automation patterns

## Troubleshooting

### Leads stuck in "Generating..."

```sql
-- Check if queue item exists and its status
SELECT * FROM commercial_intelligence_queue 
WHERE lead_id = '...' 
ORDER BY created_at DESC 
LIMIT 1;

-- If stuck in 'processing', manually reset:
UPDATE commercial_intelligence_queue 
SET status = 'pending' 
WHERE id = '...' AND status = 'processing';

-- Then run worker again
```

### Worker failing to process items

1. Check worker logs: `app/api/admin/ci-queue-worker/route.ts`
2. Verify admin authentication
3. Check `enrichLeadDirect()` logs for enrichment errors
4. Verify Supabase connection

### High failure rate

1. Check `last_error` in failed queue items
2. Common issues:
   - Website unreachable/timeout
   - Invalid website format
   - OpenAI API rate limit
   - Supabase connection issues

## Performance

- **Queue insertion**: ~10ms per item
- **Queue retrieval**: ~5ms for 10 items
- **Enrichment per lead**: 15-30 seconds (snapshot + signals + profile)
- **Worker batch size**: 10 items per run
- **Total time for 10 leads**: ~2.5-5 minutes (sequential)
- **Recommended run interval**: Every 5 minutes

## Security

- Worker endpoint requires admin authentication
- Queue records reference leads (cascade delete on lead removal)
- Error messages stored in queue (no sensitive data)
- All operations logged with `[CI-Queue]` prefix
