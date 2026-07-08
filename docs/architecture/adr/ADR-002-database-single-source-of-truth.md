# ADR-002: Database is the Single Source of Truth

**Status:** ACCEPTED  
**Date:** 2026-07-07  
**Related:** [[ADR-001]]

---

## Context

Frontend applications often maintain client-side state that diverges from server state. This creates maintenance burden, sync challenges, and bugs when the two sources conflict.

ALPA needed clear guidance on state management: what belongs in the database vs. what can be temporary UI state.

---

## Problem

Without clear state authority, systems can suffer from:
- **Dual sources of truth** — Client state and database state diverge
- **Sync debt** — Parallel state models require reconciliation logic
- **Silent failures** — UI shows one thing, database has another; user doesn't know which is correct
- **Stale UI** — Client state isn't refreshed; user sees outdated information
- **Data loss** — If client crashes, unsaved state is lost

---

## Decision

**The database is the single authoritative source of truth for all persistent data.**

Principle: "UI reflects the database."

Core rules:
1. **All persistent state lives in the database** — Nothing of consequence exists only in memory
2. **UI is a view of database state** — Components render what the database contains
3. **User actions flow: UI → API → Database → UI** — Not UI → Database with parallel local state
4. **Background workers update the database** — Not "push" state to UI; UI polls/subscribes for updates
5. **Temporary UI state is ephemeral** — Form input, loading states, collapsed/expanded sections; these are not persisted
6. **No client-side caching of persistent state** — Avoid keeping a copy of "what we think the database says"

### Practical Application

**Database state (authoritative):**
- Lead records, statuses, fields
- Commercial Intelligence results
- Outreach queue items
- Pipeline stages
- Campaign settings

**Temporary UI state (ephemeral):**
- Form input before submission
- Loading indicators
- Expanded/collapsed sections
- Sortable column order (if not persisted)
- Modal visibility
- Hover/focus states

---

## Alternatives Considered

### Alternative 1: Client-Side State Management (Redux, Zustand, Context)

Maintain client state as canonical, syncing to database asynchronously.

**Rejected because:**
- Creates two sources of truth
- Sync logic becomes complex (conflicts, retries, ordering)
- Stale UI during disconnection
- Hard to debug (which state is real?)
- Violates principle of single source of truth

### Alternative 2: Event Sourcing

Store all state changes as events; reconstruct state by replaying events.

**Rejected because:**
- Adds operational complexity
- Not needed for ALPA's scale (currently)
- Can be added later if audit trail becomes critical
- Simpler to use append-only Activity table ([[ADR-003]] pattern)

### Alternative 3: Hybrid (Client state + Database)

Maintain client cache for performance; sync in background.

**Rejected because:**
- When to trust which source?
- Reconciliation logic becomes maintenance burden
- Doesn't scale when multiple devices access same account
- ALPA is admin-only; no concurrent multi-device scenario

---

## Consequences

### Positive

✅ **Source of truth is unambiguous** — Always look to database for what's real  
✅ **Simpler code** — No sync logic, no reconciliation, no cache invalidation  
✅ **Correct under failure** — If UI crashes, database is still authoritative  
✅ **Audit trail works** — Database records are facts; UI is just rendering them  
✅ **Scales to multi-user** — When team features come, this principle keeps data consistent  
✅ **Easier debugging** — Query the database and you know what's true  

### Negative

❌ **Every state change is an API call** — Can feel slower if not optimized  
❌ **Requires good error handling** — API failures propagate to UI  
❌ **No offline mode** — UI is tightly coupled to database availability  
❌ **Database becomes bottleneck** — Can't cache, so every request hits DB  

### Mitigations

- Use optimistic updates (update UI immediately, sync with DB, rollback if fails)
- Implement proper error handling and retry logic
- Use pagination/lazy loading to avoid massive queries
- Add caching at database level (Redis, query caching)
- Eventually: background sync for offline scenarios (but phase 5+)

---

## Future Considerations

### Offline Support (Phase 5+)

If ALPA needs offline-first capabilities:
- Local database (SQLite/IndexedDB) syncs with server when online
- Server remains authoritative on conflicts
- Principle still holds: "when online, server database is authority"

### Real-time Collaboration (Year 2+)

When multiple users work on same businesses:
- Database must be transactionally consistent
- UI subscriptions (WebSocket, polling) receive updates
- Principle holds: database drives UI changes, never the reverse

### Analytics & Audit (Year 2+)

Event logging can layer on top:
- Activity table records actions on businesses
- Can query "what happened to business X?"
- Database state + activity log = complete audit trail

---

## Implementation Guidelines

### DO: Trust the Database
```typescript
// ✅ Good: Fetch from DB, render what we get
const businesses = await fetchBusinesses(userId)
setBusinesses(businesses)
return <BusinessList businesses={businesses} />
```

### DO: Optimistic Updates (UI feels fast)
```typescript
// ✅ Good: Update UI immediately, sync with DB, rollback if fails
setBusinesses(prev => [...prev, newBusiness])
await createBusiness(newBusiness).catch(() => {
  setBusinesses(prev => prev.slice(0, -1))  // rollback
})
```

### DON'T: Parallel State Models
```typescript
// ❌ Bad: Keep two versions of truth
const [uiBusinesses, setUiBusinesses] = useState([])
const [dbBusinesses, setDbBusinesses] = useState([])
// Now which one is real? If they diverge, bugs emerge.
```

### DON'T: Cache Without Invalidation
```typescript
// ❌ Bad: Cache state without refresh mechanism
let cachedBusinesses = null
function getBusinesses() {
  if (cachedBusinesses) return cachedBusinesses
  return fetch('/api/businesses').then(data => {
    cachedBusinesses = data
    return data
  })
}
// If someone else updates the DB, this cache never updates
```

### DO: Refresh After Mutations
```typescript
// ✅ Good: After creating/updating, fetch fresh data
await createBusiness(data)
const updated = await fetchBusinesses()
setBusinesses(updated)
```

---

## Examples in Codebase

**Commercial Intelligence Processing** (`lib/commercial-intelligence/process-queue.ts`)
- Queue items stored in database
- Worker claims items and processes them
- Results written back to database
- My Leads page polls `ci_enrichment_status` field
- UI always reflects database state

**My Leads Archive** (`app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx`)
- Archive button sends request to backend
- Backend updates `leads` table status
- Frontend optimistically updates UI
- On failure, rolls back to previous state

**Outreach Queue** (`app/api/leads/outreach/...`)
- Drafts stored in `outreach_queue` table
- Approvals update the table
- UI re-fetches to confirm update
- No client-side "draft" state

---

## Related Architecture

- [[ADR-001]] — My Leads repository must be database-authoritative
- [[ADR-003]] — CI results stored in database; UI reflects them
- Phase 0 — Navigation/UI changes respect this principle

---

**Approved by:** Product Architecture  
**Approval date:** 2026-07-07
