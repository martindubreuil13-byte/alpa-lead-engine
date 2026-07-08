# ADR-001: My Leads as the Permanent Business Repository

**Date:** 2026-07-07  
**Status:** ACCEPTED  
**Supersedes:** None  
**Related to:** ARCHITECTURE.md, IMPLEMENTATION_BLUEPRINT.md

---

## Summary

**Decision:** My Leads is the permanent, immutable, single source of truth for all businesses discovered or imported by a user. All other modules (Outreach, Pipeline, Discover, etc.) reference businesses in My Leads via foreign keys; no module creates, deletes, or "moves" businesses except My Leads itself.

**Implication:** The `leads` table is conceptually the "Business Repository" at the application architecture level, even though the physical table name remains `leads` for migration safety.

---

## Context

### Problem Statement

ALPA is fundamentally a **prospecting and outreach platform**, not a CRM. The core workflow is:

1. **Discover** — Find businesses matching criteria (acquisition)
2. **Qualify** — Review, enrich, organize businesses (decision-making)
3. **Outreach** — Create campaigns targeting specific businesses (execution)
4. **Track** — Monitor outcomes and relationships (lifecycle)

The previous architecture treated "leads" as transient entities that moved between states (inbox → pipeline → closed → archived). This created:

- **Conceptual confusion:** Users didn't know where their business data "lived"
- **Ownership ambiguity:** Modules appeared to own businesses, not just reference them
- **State volatility:** Leads could be archived, deleted, moved, or lost
- **UI inconsistency:** Multiple views of the same entity suggested different "destinations"

### The Principle

**Fundamental:** The Business is the permanent object. There is only one Business record. It exists only once. Everything else references that Business.

ALPA needed to reinforce:
- Businesses don't move; their status changes
- Every business stays in the repository forever (until explicitly deleted)
- Actions taken *on* a business (outreach, pipeline updates) don't move the business elsewhere
- Users always know where to find their complete business portfolio

---

## Decision

### What My Leads Is

My Leads is:
- ✅ The single authoritative view of all discovered/imported businesses
- ✅ The permanent storage for business metadata (company_name, contact_info, etc.)
- ✅ The repository where Commercial Intelligence results are attached
- ✅ The hub from which all business actions originate
- ✅ The source of truth for business status and relationships

### What My Leads Is NOT

My Leads is not:
- ❌ A "pipeline view" — Pipeline is a *view* of businesses by stage, not a container
- ❌ An "outreach queue" — Outreach Queue references businesses, doesn't contain them
- ❌ A "lead library" — Lead Library is a search refinement of the repository, not separate storage
- ❌ A "secondary inbox" — My Leads is the primary inbox; other inboxes are views

### Architectural Model

```
My Leads (Permanent Repository)
│
├─ business_id → company_name, contact_info, ci_results
├─ business_id → status (active | archived | deleted)
├─ business_id → created_at, updated_at
│
└─ Referenced by (not contained in):
    ├─ outreach_queue (link: business_id + draft)
    ├─ pipeline_stage (field: business_id + stage)
    ├─ conversation (link: business_id + email_thread)
    ├─ commercial_intelligence_queue (link: business_id + job)
    └─ activity_log (link: business_id + action)
```

No other module creates or stores business records. They only reference them via foreign keys.

---

## Alternatives Considered

### Alternative 1: Rename `leads` → `businesses` Immediately

**Proposal:** Rename the database table and update all code to use business terminology.

**Rejected because:**
- **High migration risk:** Affects 40+ code locations across API, queries, migrations
- **Zero customer value:** Doesn't improve product behavior, only internal clarity
- **Platform complexity:** Large refactor during architectural transition period
- **Test debt:** All tests touching leads/businesses would need updates

**Chosen approach:** Keep physical table named `leads`, but treat it architecturally as the Business Repository. Rename to `businesses` in a future phase when platform matures and schema is stable.

---

### Alternative 2: Distribute Business Data Across Modules

**Proposal:** Each module (Discover, Outreach, Pipeline) maintains its own "view" of businesses with specialized schemas.

**Rejected because:**
- **Data duplication:** Same business data stored multiple times
- **Consistency risk:** Versions diverge across modules
- **Sync complexity:** Would need reconciliation logic
- **Query inefficiency:** Need joins across business tables
- **Violates "permanent object" principle**

---

### Alternative 3: Make Leads Immutable (No Archive/Delete)

**Proposal:** Once created, a business can never be archived or deleted, only status-changed.

**Rejected because:**
- **User expectation:** People expect to remove spam/duplicates
- **Privacy requirement:** Users may need deletion for GDPR/data hygiene
- **UX friction:** No way to manage old/irrelevant businesses
- **Still references correctly:** Archive is just `status = 'archived'`, not true deletion

**Chosen approach:** Archive/delete are status changes, not removals from repository. Soft-delete pattern with 30-day recovery window aligns with user expectations while maintaining data integrity.

---

## Rationale

### Why This Decision Matters

1. **Coherence at Scale**
   - At 100 businesses: single lead view is manageable
   - At 1,000 businesses: need clear single source of truth to avoid confusion
   - At 100,000 businesses: absolute requirement for consistency
   - At 1,000,000 businesses: architectural principle becomes load-bearing

2. **User Mental Model**
   - "I have 500 businesses in ALPA" — single place to look
   - "I want to see all active businesses" — filtered view of the repository
   - "I want to outreach this business" — action taken *on* the business
   - "I want to check this business's status" — look in the repository

3. **Developer Clarity**
   - New module dependencies only on `leads` table
   - No circular references (outreach → pipeline → leads)
   - Foreign keys all point to `leads` (id), never the reverse
   - Single source of schema truth

4. **Future Scalability**
   - Can partition/shard on user_id + business_id
   - Outreach Queue, Pipeline, Conversations are just indexed views
   - Database can evolve without changing conceptual model
   - New modules (Team sharing, Portfolio management, etc.) naturally layer on top

---

## Implementation Consequences

### What Changes

**Phase 0: Clarification** (now)
- Navigation reorganizes to surface My Leads prominently
- Remove duplicate modules (Leads Inbox, Lead Library)
- Reframe archive/delete as status changes, not moves
- Update button routing (Outreach button → action on business)

**Phase 1-4: Progressive evolution** (12 weeks)
- Add Conversation entity (references business)
- Add Campaign + Campaign Membership (references business)
- Add Opportunity entity (references business + conversation)
- Rename internal terminology: "lead" → "business" in code/comments

**Future: Full architectural clarity** (months 3+)
- Rename physical table `leads` → `businesses` when schema is stable
- Support team features (all businesses multi-tenant reference to leads/businesses)
- Full activity logging (every business action in append-only log)

### What Stays the Same

- ✅ Database table name: `leads` (migration risk not worth it)
- ✅ Discover/Scraper functionality
- ✅ Commercial Intelligence system
- ✅ Email sending/Outreach Queue logic
- ✅ Pipeline stage tracking
- ✅ Existing data

### Breaking Changes (Minimal)

- Users are now *required* to use My Leads as their workspace (not optional/admin-only)
- Archive is now a status filter, not a separate view
- "Leads Inbox" redirects to My Leads or is removed
- "Lead Library" functionality merges into My Leads search

---

## Decision Quality Checklist

✅ **Reversible?** Mostly. Navigation changes are reversible. Table rename can be done later if needed.

✅ **Principle-aligned?** Yes. "Business is permanent object" is the foundation.

✅ **Scalable?** Yes. Holds at any scale; improves with scale.

✅ **Team-understandable?** Yes. Single source of truth is clearer than distributed ownership.

✅ **User-coherent?** Yes. Users have one place to "see all my businesses" at any time.

✅ **Reduces coupling?** Yes. All modules couple only to `leads` table, not to each other.

✅ **Reduces complexity?** Yes. Removes mental model of "lead movement" between modules.

✅ **Safe to implement?** Yes. Phase 0 is UI-only; no data schema changes; no worker/API changes; reversible.

---

## Risks & Mitigations

### Risk 1: Users Expect Archive to Hide Leads

**Severity:** Medium  
**Mitigation:** Filter UI clearly shows archived leads in separate tab; default view is "Active only"

### Risk 2: Admin-Only Leads Becomes Friction for Free Users

**Severity:** Medium  
**Mitigation:** Remove admin-only restriction from My Leads; all users access same repository (just limited by plan on search credits)

### Risk 3: Performance Regresses if All Leads Load in One View

**Severity:** Low  
**Mitigation:** Use pagination, lazy loading, or search-first UX; previous implementation already loads all leads into My Leads

### Risk 4: Developers Forget "Leads Are Permanent" and Create Deletion Logic

**Severity:** Medium  
**Mitigation:** This ADR becomes permanent architecture reference; code reviews check for repository principle violations

---

## Decision Criteria Met

| Criterion | Assessment | Evidence |
|-----------|-----------|----------|
| **Clear to implement** | ✅ | Phase 0 scope is defined (nav, accessibility, UI clarity) |
| **Reduces confusion** | ✅ | Single source of truth vs. three duplicate views |
| **Aligns with product principle** | ✅ | "Business is permanent object" is core philosophy |
| **Doesn't require schema change** | ✅ | Purely architectural; `leads` table stays as-is |
| **Scales to 1M businesses** | ✅ | Repository pattern is foundational to scale |
| **Unblocks future features** | ✅ | Conversations, Campaigns, Opportunities can cleanly reference repository |
| **User-understandable** | ✅ | "My Leads = all my businesses" is intuitive |
| **Doesn't break existing data** | ✅ | No schema changes; no data loss; reversible |

---

## Long-term Implications

### This Decision Enables Future Phases

- **Phase 1: Conversations** — Can cleanly model as business → email_thread → messages
- **Phase 2: Campaigns** — Campaign membership table clearly references businesses from repository
- **Phase 3: Opportunities** — Opportunity is business + conversation + outcome, all referencing repository
- **Phase 4+: Team Features** — Multi-user collaboration on businesses; all users referencing same repository
- **Year 2: Integrations** — External CRMs can sync to businesses, knowing there's one source

### This Decision Constrains Future Choices

- No support for "lead duplication" across accounts (one business = one record)
- No support for "moving leads" between users (would require business reassignment logic)
- No support for "partial businesses" without a repository entry
- Naming must always stay coherent (repository is singular source, not "copies" or "views")

---

## Related Documents

- **ARCHITECTURE.md** — Foundational product architecture; details how Business is permanent center
- **IMPLEMENTATION_BLUEPRINT.md** — 12-week roadmap; Phase 0 is first step of this plan
- **PHASE_0_AUDIT.md** — Detailed audit of current violations; implementation plan for Phase 0

---

## References & Rationale

**Domain-Driven Design Principle:** Entities (in this case, Business) should have clear identity and lifecycle. Everything else is either value objects or aggregates referencing the entity.

**Single Responsibility Principle:** My Leads has one job: be the repository. Other modules have one job: reference and act on businesses in the repository.

**Coherence at Scale:** This architectural pattern is used successfully by:
- Salesforce (Account is permanent; opportunities/activities reference it)
- HubSpot (Company is permanent; contacts/deals reference it)
- Pipedrive (Company/lead is permanent; activities/deals reference it)

---

## Approval & Sign-Off

**Decision Maker:** Product Architecture (Martin Dubreuil)  
**Date Decided:** 2026-07-07  
**Implementation Start:** After approval of Phase 0 scope  
**Expected Completion:** End of Phase 0 (2026-07-14, estimated)

---

## Revision History

| Date | Version | Change |
|------|---------|--------|
| 2026-07-07 | 1.0 | Initial ADR; approved for Phase 0 implementation |

---

## Summary Statement

**My Leads is the permanent home of every business. Other modules are tools that reference those businesses. Businesses don't move between modules; their status changes. This architecture will scale from freelancers with 50 businesses to platforms with millions, because the principle is load-bearing from day one.**

