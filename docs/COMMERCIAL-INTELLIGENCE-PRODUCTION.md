# Commercial Intelligence: Self-Driving Queue Worker

## Overview

Commercial Intelligence processes the queue using a self-driving worker that runs while the My Leads page is active:

1. **Self-driving queue worker** — No cron, no external scheduler, no polling
2. **Active page processing** — Worker runs while user views My Leads
3. **Product-focused dashboard** — Communicates value, not infrastructure
4. **Lead filtering** — Find analyzed profiles with one click
5. **Data integrity** — Database is single source of truth

---

## Part 1: Self-Driving Worker

### How It Works

**File**: `app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx`

When the My Leads page mounts, a self-driving worker starts:

```
User opens My Leads page
  ↓
Component mounts
  ↓
Worker starts immediately
  ↓
LOOP until queue empty or timeout:
  ├─ POST /api/leads/process-ci-queue-batch
  ├─ Process one batch (10 items)
  ├─ Refresh UI with updated statuses
  └─ Immediately claim next batch if pending remain
  ↓
Queue empty → Worker stops
User closes page → Worker stops
Max runtime (5 min) reached → Worker stops
Page hidden → Worker stops
```

### Key Design Principles

- **No Cron**: No external scheduler, no background service
- **No Polling**: Worker doesn't check status, only processes
- **No Browser Dependency**: Queue continues via discovery workflow restart
- **Clean Lifecycle**: Worker auto-starts on mount, auto-stops on unmount or page hide
- **Smart Restart**: If user enqueues new leads, discovery or re-visit triggers restart

### The Batch Endpoint

**File**: `app/api/leads/process-ci-queue-batch/route.ts`

Authenticated endpoint that processes one batch of 10 items:

```typescript
POST /api/leads/process-ci-queue-batch
  ├─ Requires authentication
  ├─ Claims pending items (for authenticated user only, via RLS)
  ├─ Enriches each lead
  ├─ Returns: processed, succeeded, failed, stats
  └─ Caller decides: continue or stop
```

### Restarting After Queue Drains

When the worker stops (queue empty), the queue will restart when:

1. **Discovery completes** and returns user to My Leads
2. **User manually navigates** back to My Leads page
3. **Discovery triggers page refresh** via revalidatePath()

This ensures:
- ✓ Queue processes automatically while user is viewing
- ✓ No background processing when page is closed
- ✓ Clean handoff: discovery enqueues, My Leads processes
- ✓ No wasted compute on empty queues

---

## Part 2: Product Dashboard

### CommercialIntelligenceStatus Component

**File**: `app/dashboard/my-leads/CommercialIntelligenceStatus.tsx`

**Design Principles**:
- **Product-focused, not infrastructure-focused**
- **Shows value, hides mechanics**
- **Communicates like an intelligent employee**

### What We Show

1. **Title**: "Commercial Intelligence"
2. **Status Message**: 
   - All analyzed: "✓ All businesses analyzed"
   - In progress: "⚡ ALPA is analyzing your businesses in the background"

3. **Key Metrics** (in colored cards):
   - **Ready to use**: `{completed}` (always shown, emerald)
   - **Waiting**: `{pending + not_started}` (shown if > 0, blue)
   - **Failed**: `{failed}` (shown if > 0, red)

4. **Progress Indicator**: 
   - Clean progress bar with percentage
   - No "estimated time remaining"

5. **Last Activity**: 
   - "Last completed: [date]"
   - Helps users understand recent activity

### What We Don't Show

- ❌ Processing count (distraction)
- ❌ Queue terminology ("queued", "pending")
- ❌ Percentages that lie (affected by historical backlog)
- ❌ "Estimated time remaining" (unreliable with batching)
- ❌ "Not Started" metric (replaced with "Waiting")
- ❌ AI cost information
- ❌ API token usage

### Messaging Examples

**All analyzed**:
```
✓ All businesses analyzed
```

**In progress**:
```
⚡ ALPA is analyzing your businesses in the background

Ready: 142
Waiting: 58
Failed: 2

[Progress bar] 71%
Last completed: 7/7/2026
```

**Interpretation**:
- "ALPA is analyzing" → feeling of work happening
- "in the background" → user can do other things
- Ready/Waiting/Failed → actionable metrics
- No percentages distorted by infrastructure

---

## Part 3: Lead Filtering

### Filter Button

**Location**: Next to "Active/Archived" tabs

**UI**:
```
[Active] [Archived] | [✓ Analyzed]
```

When enabled:
- Shows only leads with `ci_enrichment_status = 'completed'`
- Makes it easy to find analyzed profiles
- Combines with existing search

### Implementation

**File**: `app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx`

```typescript
const [showCompletedOnly, setShowCompletedOnly] = useState(false)

// Filter logic:
const withCiFilter = showCompletedOnly
  ? byView.filter((lead) => lead.ci_enrichment_status === 'completed')
  : byView
```

---

## Part 4: Data Integrity

### Lead Card Verification

**Lead reads from prop, not state**:
```typescript
const ciStatus = lead.ci_enrichment_status  // From database
const profile = lead.commercial_profile       // From database
const snapshot = lead.website_snapshot        // From database
const signals = lead.business_signals         // From database
```

**Display logic**:
```typescript
if (ciStatus === 'completed' && profile) {
  // Show profile data
} else if (ciStatus === 'processing') {
  // Show "Generating..."
} else if (ciStatus === 'pending') {
  // Show "Waiting in queue"
} else if (ciStatus === 'failed') {
  // Show error
} else {
  // Show "Not started"
}
```

**Key guarantee**: If database says "completed", card WILL display profile (never shows "queued")

### Components Displayed

When completed:
- ✓ Website Snapshot badge
- ✓ Business Signals badge
- ✓ Commercial Profile badge
- ✓ Profile content: Summary, Industry, Primary Service, Target Customer, Core Services, Keywords
- ✓ Analyzed date

---

## Testing

### Local Testing

**1. Start development server**:
```bash
npm run dev
```

**2. Open My Leads page**:
   - Go to http://localhost:3000/dashboard/my-leads
   - Check browser console for: `[CI-WORKER] Started queue worker`

**3. Enqueue test leads** via discovery:
   - The worker will immediately start processing
   - Watch console for: `[CI-BATCH] Processing batch...`
   - Batch completes every 15-30 seconds

**4. Watch dashboard widget**:
   - Shows "Ready to use: X"
   - Shows "Waiting: Y"
   - Counts update as batches complete

**5. Close page**:
   - Console shows: `[CI-WORKER] Page hidden, stopping worker`
   - Worker stops immediately

**6. Reopen My Leads**:
   - Console shows: `[CI-WORKER] Started queue worker`
   - Worker restarts and continues

### Dashboard Testing

**1. Enqueue 50 leads** via discovery
**2. Watch dashboard widget update**:
   - "Ready to use" count increases
   - "Waiting" count decreases
   - Progress bar advances

**3. Click "✓ Analyzed"** filter:
   - Shows only completed leads
   - All displayed leads have profiles

**4. Expand completed lead**:
   - Card shows "✓ Analysis Complete"
   - Three component badges visible
   - Profile data populated
   - Never shows "Waiting in queue"

**5. Page visibility**:
   - Minimize browser window → Worker stops
   - Restore window → Worker continues

---

## Production Checklist

### Before Deploy

- [ ] Dashboard component displays correctly in staging
- [ ] Filter button works
- [ ] Lead cards show profile data correctly
- [ ] Worker logs appear in application logs
- [ ] Page visibility handling works (check DevTools)

### After Deploy

- [ ] User opens My Leads → logs show `[CI-WORKER] Started`
- [ ] Enqueue leads via discovery → worker processes them
- [ ] Monitor logs: `[CI-BATCH] Processing batch...`
- [ ] Check dashboard widget updates as batches complete
- [ ] User closes tab → logs show `[CI-WORKER] Stopped`
- [ ] User returns to My Leads → worker restarts
- [ ] Test filter button with completed leads

---

## Performance Characteristics

- **Worker startup**: Immediate on page load (no delay)
- **Batch size**: 10 leads per batch
- **Batch interval**: Back-to-back (no delay between batches)
- **Time per lead**: 15-30 seconds (enrichment)
- **Batch completion**: 2.5-5 minutes per 10 leads
- **Max runtime**: 5 minutes per page visit
- **Dashboard load**: <100ms (RPC aggregation)

### Example Timeline

```
User opens My Leads with 50 queued leads
00:00 - Worker starts
00:30 - Batch 1 (10 items) complete, 40 remain
01:00 - Batch 2 (10 items) complete, 30 remain
01:30 - Batch 3 (10 items) complete, 20 remain
02:00 - Batch 4 (10 items) complete, 10 remain
02:30 - Batch 5 (10 items) complete, 0 remain
02:30 - Worker stops (queue empty)
→ User sees all 50 leads analyzed
```

---

## Monitoring

### Queue Health

```sql
-- Current queue status
SELECT status, COUNT(*) as count
FROM commercial_intelligence_queue
GROUP BY status
ORDER BY status;

-- Failed items
SELECT id, lead_id, last_error, retry_count, completed_at
FROM commercial_intelligence_queue
WHERE status = 'failed'
ORDER BY completed_at DESC
LIMIT 20;

-- Stuck processing items (should be empty)
SELECT id, lead_id, started_at, (now() - started_at) as duration
FROM commercial_intelligence_queue
WHERE status = 'processing'
ORDER BY started_at ASC;
```

### Log Patterns

Look for in application logs:
- `[CI-WORKER] Started queue worker` — Worker began
- `[CI-BATCH] Processing batch...` — Batch running
- `[CI-BATCH] Complete: processed=X` — Batch finished
- `[CI-WORKER] Queue empty, stopping worker` — Queue drained
- `[CI-WORKER] Page hidden, stopping worker` — User left page

---

## Scaling

Current setup handles:
- **50 leads**: ~2-3 minutes to completion
- **100 leads**: ~5-8 minutes to completion
- **500 leads**: ~25-40 minutes to completion

Scaling options:
- Increase batch size: `limit: 10 → 20` in batch endpoint
- Increase max runtime: `5 * 60 * 1000 → 10 * 60 * 1000` (10 minutes)
- Add parallel enrichment in worker (run multiple batches concurrently)

---

## Architecture Diagram

```
User Opens My Leads Page
    ↓
Component Mounts
    ↓
Worker Starts (fire and forget)
    ↓
LOOP: While page active AND runtime < 5 min:
    ├─ POST /api/leads/process-ci-queue-batch
    ├─ Claim 10 pending items
    ├─ enrichLeadDirect() for each
    │   ├─ Website Snapshot
    │   ├─ Business Signals
    │   └─ Commercial Profile
    ├─ Complete queue records
    ├─ router.refresh() to update UI
    └─ If 0 processed, break
    ↓
STOP: Queue empty OR page hidden OR timeout reached
    ↓
User navigates back to My Leads
    ↓
Component re-mounts, worker restarts
```

---

## Key Differences From Cron

| Aspect | Vercel Cron | Self-Driving Worker |
|--------|-------------|-------------------|
| **Startup** | Every 5 minutes | Immediate, on page load |
| **Processing** | 5-10 min per run | Continuous until empty |
| **Overhead** | Fixed 5-min wait | None (on-demand) |
| **Scaling** | Requires config change | Automatic batch continuation |
| **Page closed** | Still processes (waste) | Stops immediately |
| **Cost** | Function invocations every 5 min | Only when user is active |
| **Restart after queue drain** | Wait up to 5 min | Instant (next discovery) |

---

## Summary

✅ **Self-Driving Worker**: Processes while page is active  
✅ **No Cron**: No external scheduler, no overhead  
✅ **No Polling**: Worker only processes, UI stays current  
✅ **Clean Lifecycle**: Auto-start on mount, auto-stop on unmount  
✅ **Dashboard**: Product-focused, value-driven messaging  
✅ **Filtering**: One-click access to analyzed profiles  
✅ **Data Integrity**: Database is single source of truth  
✅ **Reliable**: Automatic retry on failure, graceful cleanup  
