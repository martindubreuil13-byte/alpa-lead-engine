# ADR-001: My Leads is the Permanent Business Repository

**Status:** ACCEPTED  
**Date:** 2026-07-07  
**Related:** [[ADR-002]], [[ADR-004]]

---

## Context

ALPA is a prospecting and outreach platform. Users discover businesses, organize them, create campaigns targeting them, and track outcomes. The platform had evolved with multiple views of lead/business data (My Leads, Leads Inbox, Lead Library) and unclear ownership semantics.

A scalable platform needs a clear, single source of truth for core entities.

---

## Problem

Without a clear repository principle, the architecture suffered from:
- **Semantic confusion:** Users didn't know where their business data "lived"
- **Unclear ownership:** Did Outreach Queue "own" leads while drafts existed? Did Pipeline "own" them while moving stages?
- **Redundancy:** Multiple UI views of the same data suggested multiple storage locations
- **Scaling risk:** At 100 businesses, confusion is manageable. At 1M businesses, it becomes untenable.

---

## Decision

**My Leads is the permanent, authoritative repository for all discovered businesses.**

Core principles:
- Each business exists exactly once in the `leads` table (physical storage)
- My Leads is the conceptual "Business Repository" (architectural role)
- All other modules (Discover, Outreach, Pipeline, etc.) reference businesses via foreign keys
- No module creates, deletes, or "moves" businesses except My Leads itself
- Businesses have a `status` field; changes to status are the only "movement"
- Archive and delete are status changes, not removals from repository

### Physical Table Name vs. Conceptual Role

The physical database table remains named `leads` for migration safety. However, architecturally it is treated as the Business Repository. Future rename to `businesses` can happen when schema is fully stable (Phase 5+).

---

## Alternatives Considered

### Alternative 1: Distributed Lead Data Across Modules

Each module (Discover, Outreach, Pipeline) maintains specialized schemas and data versions.

**Rejected because:**
- Data duplication creates sync burden
- Versions diverge across modules
- No single source of truth
- Violates coherence principle

### Alternative 2: Immediate `leads` → `businesses` Rename

Rename the physical table and update all 40+ code locations.

**Rejected because:**
- High migration risk for zero customer value
- Introduces schema churn during architectural transition
- Can be done safely later when schema is stable

### Alternative 3: Immutable Businesses (No Archive/Delete)

Once created, businesses can never be archived or deleted.

**Rejected because:**
- Users need to remove duplicates and spam
- Privacy requirements (GDPR) require deletion capability
- Soft-delete with recovery window better balances user needs with data integrity

---

## Consequences

### Positive

✅ **Single source of truth** — All business data in one place; no duplication  
✅ **Clear module roles** — Each module knows its responsibility (reference, not own)  
✅ **User mental model** — "My Leads is where all my businesses live"  
✅ **Scales indefinitely** — Pattern works at 100 or 1M businesses  
✅ **Enables future features** — Conversations, Campaigns, Opportunities naturally reference repository  
✅ **Reduces coupling** — Modules depend only on `leads` table, not on each other  

### Negative

❌ **Constraints future design** — All business entities must reference this repository  
❌ **Naming debt** — Table named `leads` while conceptually `businesses` (resolved in Phase 5)  
❌ **No module-specific data isolation** — Can't have specialized storage per module  

---

## Future Considerations

### Phase 5: Terminology Alignment

When the database schema is fully stable and all existing migrations are complete, rename `leads` → `businesses` for terminological clarity. This is safe but not urgent.

### Team Features (Year 2+)

When supporting multiple users accessing shared businesses:
- All users reference same `businesses` repository (multi-tenant via user_id)
- Ownership/permissions stored separately
- Repository principle holds; permission model adds layer on top

### Integrations (Year 2+)

External CRM sync will reference this repository. Single source of truth principle becomes even more critical.

### Historical Intelligence

Commercial Intelligence results are versioned and attached to businesses (see [[ADR-003]]). Repository continues to be the authoritative record even as enrichment data evolves.

---

## Implementation Notes

- See [[ADR-004]] for how each module respects this principle
- See [[ADR-002]] for how database state is kept authoritative
- Phase 0 implements UI/navigation changes to make this principle obvious to users
- No schema migration needed; principle is architectural, not physical

---

## Related Architecture

This decision is foundational. All future entity decisions must respect it:
- Conversations reference businesses (not owned by Outreach)
- Campaigns reference businesses (not owned by campaigns module)
- Opportunities reference businesses (not owned by Pipeline)
- Activities reference businesses (not owned by Outreach/Pipeline)

---

**Approved by:** Product Architecture  
**Approval date:** 2026-07-07
