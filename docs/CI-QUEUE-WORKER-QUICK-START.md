# Commercial Intelligence Queue Worker — Quick Start

## What Changed

**Before**: Vercel Cron ran every 5 minutes + 30-second polling from browser  
**After**: Self-driving worker runs when My Leads page is active

## How It Works

```
User opens My Leads page
  ↓
MyLeadsWorkspaceClient mounts
  ↓
useEffect starts worker (fire and forget)
  ↓
Worker POSTs to /api/leads/process-ci-queue-batch
  ↓
Batch endpoint processes 10 items, returns result
  ↓
Worker calls router.refresh() to update UI
  ↓
If processed > 0, loop back to POST (no delay)
If processed = 0, worker stops
```

## Files

### Client Side
- **app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx** (lines 364-425)
  - useEffect initializes worker
  - Handles page visibility (stops if hidden)
  - Respects 5-minute max runtime

### Server Side
- **app/api/leads/process-ci-queue-batch/route.ts**
  - Authenticated endpoint
  - Processes one batch (10 items)
  - Returns: processed count, success/fail counts

### Removed
- ❌ `/api/cron/process-ci-queue` (Vercel Cron)
- ❌ 30-second polling from MyLeadsWorkspaceClient
- ❌ `POST /api/leads/process-commercial-intelligence-queue` (browser trigger)

## Testing

### Watch the Worker

Open browser DevTools Console, go to My Leads, look for:
```
[CI-WORKER] Started queue worker
[CI-BATCH] Processing batch...
[CI-BATCH] Complete: processed=10 succeeded=8 failed=2
[CI-WORKER] Queue empty, stopping worker
```

### Simulate Activity

1. Go to Scraper → Create discovery with 50 leads
2. Open My Leads → Worker starts
3. Watch dashboard update every 2-5 minutes per batch
4. Worker stops when queue is empty
5. Close browser tab → Logs show `[CI-WORKER] Page hidden, stopping worker`

### Test Page Visibility

```javascript
// In DevTools Console, simulate page hiding:
Object.defineProperty(document, 'hidden', { value: true })
document.dispatchEvent(new Event('visibilitychange'))

// Logs should show: [CI-WORKER] Page hidden, stopping worker
```

## Key Differences

| Aspect | Before | After |
|--------|--------|-------|
| Start | Every 5 minutes (fixed) | Immediate on page load |
| Stop | Never (always checking) | When queue empty |
| Batch Processing | Sequential, fixed 5-min wait | Continuous, no delay |
| Page Closed | Still processes (wasted compute) | Stops immediately |
| Restart | Wait for next 5-min cron | Auto-restart on page visit |
| Cost | Fixed interval cost | On-demand only |

## Performance

For 50 enqueued leads:
- Batch 1 (10 items): 2.5-5 min
- Batch 2 (10 items): 2.5-5 min  
- Batch 3 (10 items): 2.5-5 min
- Batch 4 (10 items): 2.5-5 min
- Batch 5 (10 items): 2.5-5 min
- **Total: ~15 minutes start-to-finish** (sequential batches)

## Logs to Watch

```
Worker Started
└─ [CI-WORKER] Started queue worker

Processing Loop
├─ [CI-BATCH] Processing batch...
├─ [CI-BATCH] Complete: processed=10 succeeded=8 failed=2

Page Hidden
└─ [CI-WORKER] Page hidden, stopping worker

Queue Empty
└─ [CI-WORKER] Queue empty, stopping worker

Component Unmounted
└─ [CI-WORKER] Component unmounted, cleaned up
```

## No Polling, No Cron

The key design:
- **No cron**: No external scheduler
- **No polling**: Worker only processes, doesn't check status
- **No timer**: Worker calls endpoint once per batch, no setTimeout loop
- **Smart stop**: Worker stops when result.processed = 0 (queue empty)
- **Page aware**: Worker respects visibility API (stops when page hidden)

## What About New Items?

If user enqueues new items:
1. Discovery completes → returns to My Leads (triggers page mount)
2. Component re-mounts → Worker restarts
3. Worker sees pending items → Continues processing

OR:

1. User refreshes page manually → Component re-mounts → Worker restarts

The database is the source of truth. New items in queue = new work for worker.
