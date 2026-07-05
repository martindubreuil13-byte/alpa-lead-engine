# Commercial Intelligence Queue — Production Architecture

## Overview

The Commercial Intelligence enrichment is now powered by a durable Supabase-backed queue, ensuring reliable background processing in serverless environments.

```
Lead Discovery
    ↓
Lead Saved to Database ✓
    ↓
Queue Record Inserted ✓
    ↓
Response Returned to User ✓
    ↓
(Background - Guaranteed Completion)
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
- `getPendingQueueItems(limit)` — Retrieve pending items
- `markQueueItemProcessing(queueId)` — Mark as started
- `markQueueItemCompleted(queueId)` — Mark as done
- `markQueueItemFailed(queueId, error, shouldRetry)` — Mark as failed with retry option
- `getQueueStats()` — Monitoring helper

**Key principle**: The queue only manages persistence and status. It never calls the enrichment engine directly.

### The Worker

**File**: `app/api/admin/ci-queue-worker/route.ts`

- **Endpoint**: `POST /api/admin/ci-queue-worker` (admin-only)
- **Max duration**: 5 minutes (configurable)
- **Flow**:
  1. Get up to 10 pending queue items
  2. For each item:
     - Mark as processing
     - Call `enrichLeadDirect(leadId)`
     - Mark as completed or failed
     - Retry on failure (up to 2 retries)
  3. Return stats and results

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
Response returned immediately
(No wait for enrichment)
```

**User experience**:
- Search results appear instantly (~2-3 seconds)
- Lead shows `ci_enrichment_status = 'pending'` or `'processing'`
- No blocking, no enrichment delay

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

### 3. Queue Processing (Background Worker)

```
Worker started (manually or via cron):
  POST /api/admin/ci-queue-worker
  ↓
Retrieve pending items (limit 10)
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

### Cron Worker Authentication

The production queue worker is scheduled by Vercel Cron:

```json
{
  "path": "/api/admin/ci-queue-worker",
  "schedule": "*/5 * * * *"
}
```

Required environment variable:

```bash
CI_QUEUE_WORKER_SECRET=your-secret-value
```

Set `CI_QUEUE_WORKER_SECRET` in Vercel under Project Settings → Environment Variables for Production. The worker accepts `x-ci-worker-secret: <secret>` and `Authorization: Bearer <secret>` for cron-compatible invocation. Authenticated admins can still run the worker manually.

Vercel Cron sends its built-in secret as an `Authorization` header when `CRON_SECRET` is set. Set `CRON_SECRET` to the same value as `CI_QUEUE_WORKER_SECRET`, or keep both configured; the worker accepts either `Authorization: Bearer $CI_QUEUE_WORKER_SECRET` or `Authorization: Bearer $CRON_SECRET`.

Manual local test:

```bash
curl -X GET http://localhost:3000/api/admin/ci-queue-worker \
  -H "x-ci-worker-secret: $CI_QUEUE_WORKER_SECRET"
```

Manual production test:

```bash
curl -X GET https://your-api.com/api/admin/ci-queue-worker \
  -H "x-ci-worker-secret: $CI_QUEUE_WORKER_SECRET"
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

#### Option 1: Manual Trigger (Development)

```bash
# Trigger worker manually
curl -X POST https://your-api.com/api/admin/ci-queue-worker \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Option 2: Scheduled via Vercel Cron (Production)

Create `app/api/cron/enrich-ci-queue/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { enrichCIQueue } from '@/lib/commercial-intelligence/process-queue'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await enrichCIQueue()
  return NextResponse.json(result)
}
```

In `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/enrich-ci-queue",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

#### Option 3: Supabase Scheduled Query (Alternative)

Set up a scheduled SQL query in Supabase to call a webhook every 5 minutes.

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
