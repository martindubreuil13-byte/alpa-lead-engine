# ADR-003: Commercial Intelligence Architecture

**Status:** ACCEPTED  
**Date:** 2026-07-07  
**Related:** [[ADR-001]], [[ADR-002]]

---

## Context

ALPA enriches businesses with AI-powered research (Commercial Intelligence). Early implementations sometimes overwrote enrichment results. As the platform evolves, it needs to:
- Preserve enrichment history for audit trails
- Support multiple CI models and versions
- Allow re-enrichment without losing previous insights
- Evolve CI capabilities without breaking existing data

---

## Problem

Without clear principles, CI implementation risked:
- **Data loss** — Overwriting enrichment results without preserving history
- **Version ambiguity** — Not knowing which CI model produced results
- **Re-enrichment conflicts** — Running new enrichment over old results without clear semantics
- **Audit trail gaps** — No way to know "when was this business last enriched?"

---

## Decision

**Commercial Intelligence is versioned enrichment data, not the business itself.**

Core principles:

1. **CI belongs to businesses** — Attached to `leads` table, not separate storage
2. **CI evolves over time** — Multiple enrichment results can exist; newer ones supplement, not replace older ones
3. **CI results are immutable** — Once created, a CI result is never deleted or modified
4. **CI versions are tracked** — Store which model/version produced each result
5. **Historical intelligence is preserved** — Don't overwrite; keep previous enrichments for audit
6. **CI is enhancement, not source of truth** — Businesses exist without CI; CI is optional metadata

### Schema Pattern

```sql
-- Enrichment results versioned by timestamp
-- Column: ci_completed_at (when this enrichment finished)
-- Column: ci_model_versions (JSON of {model: version} used)
-- Column: commercial_profile, website_snapshot, business_signals (immutable results)

-- Future: separate versioned table
-- CREATE TABLE commercial_intelligence_results (
--   id UUID,
--   lead_id UUID (refs leads.id),
--   completed_at TIMESTAMP,
--   model_versions JSONB,
--   results JSONB,
--   created_at TIMESTAMP
-- )
-- This allows querying full enrichment history without bloating leads table
```

---

## Alternatives Considered

### Alternative 1: Overwrite on Re-enrichment

Each time a business is re-enriched, replace the old results.

**Rejected because:**
- No audit trail (can't see what changed)
- Loses historical context
- Can't compare results from different CI versions
- Creates uncertainty: "When was this last updated?"

### Alternative 2: Separate CI Database

Store enrichment in a completely separate data store.

**Rejected because:**
- Violates [[ADR-001]] (businesses should have enrichment attached)
- Adds query complexity (join across tables)
- Sync burden (if business deleted, must also delete CI)
- Not needed for current scale

### Alternative 3: Archive Old Results in S3

Store previous enrichments in object storage; only latest in database.

**Rejected because:**
- Adds operational complexity
- Slow to query enrichment history
- Can defer to Phase 3+ when audit requirements are clear

---

## Consequences

### Positive

✅ **Audit trail preserved** — Can see when/how business was enriched  
✅ **Safe re-enrichment** — Can run new CI without fear of losing data  
✅ **Version tracking** — Know which CI model/version produced results  
✅ **Progressive enhancement** — New CI features can coexist with old results  
✅ **Supports comparisons** — Can compare older vs. newer enrichment for same business  
✅ **Complies with [[ADR-002]]** — Database is immutable source of truth for enrichment  

### Negative

❌ **Table bloat** — More columns in leads table for CI results  
❌ **Update complexity** — Immutable results require careful append logic  
❌ **Query complexity** — Longer queries to find "latest" enrichment  

### Mitigations

- Phase 1: Versioned results table (`commercial_intelligence_results`) separates CI data from leads table
- Add index on `(lead_id, completed_at DESC)` for fast "latest" queries
- Application layer handles "get latest CI for business" as common pattern

---

## Future Considerations

### Phase 1: Versioned CI Table

Separate versioned results table prevents leads table bloat:

```sql
CREATE TABLE commercial_intelligence_results (
  id UUID PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  user_id UUID REFERENCES auth.users(id),
  completed_at TIMESTAMP NOT NULL,
  model ENUM ('gpt-4', 'claude-3', ...),
  model_version VARCHAR(50),
  
  -- Immutable results
  summary TEXT,
  industry VARCHAR(255),
  primary_service TEXT,
  target_customer TEXT,
  core_services TEXT[],
  keywords TEXT[],
  website_snapshot JSONB,
  business_signals JSONB,
  
  -- Metadata
  processing_duration_ms INTEGER,
  cost_estimate DECIMAL,
  created_at TIMESTAMP DEFAULT NOW()
)

CREATE INDEX idx_ci_latest 
  ON commercial_intelligence_results(lead_id, completed_at DESC)
```

Benefits:
- Leads table stays lean
- Full enrichment history queryable
- Can retention-policy old results (keep 2 years, archive rest)
- Easier to version CI schema independently

### Phase 2: Cross-Version Comparisons

Feature: "How has this business profile changed over time?"
- Query multiple CI results for same business
- Show before/after differences
- Detect industry shifts, service changes, etc.

### Phase 3: CI Model Selection

Feature: "Run with model X to get a second opinion"
- Same business can have multiple concurrent enrichments (different models)
- Compare results side-by-side
- "Confidence score" based on model agreement

### Future AI Versions

When new AI models become available:
- Old CI results remain unchanged (immutable)
- New enrichments use new models
- Supports gradual migration (old results still useful)
- Can keep multiple models for comparison

---

## Implementation Notes

Current state:
- Stores latest CI in `leads` table (columns: `ci_enrichment_status`, `commercial_profile`, etc.)
- Queue-based processing (`commercial_intelligence_queue` table)
- Worker is pure consumer; never creates work

Phase 0.1: No changes to CI architecture (stable and working)
Phase 1: Consider versioned results table for scalability

---

## Queue Architecture

Commercial Intelligence uses a persistent queue:
- **claim_ci_queue_items()** — Worker claims items atomically
- **backfill_missing_ci_queue_entries()** — Repair utility finds unqueued businesses
- **audit_ci_queue_consistency()** — Verify queue completeness

Worker is pure consumer (see [[ADR-004]]); never creates work. Lead creation endpoints enqueue work synchronously.

---

## Monitoring

Questions to ask:
- How many businesses lack CI? (repair utility can fix)
- How long does CI processing take? (monitor latency)
- Which businesses failed CI? (track `ci_last_error`)
- How often is CI re-run? (monitor queue processing)

---

## Related Architecture

- [[ADR-001]] — CI is enhancement to businesses in repository
- [[ADR-002]] — CI results immutable in database; UI reflects them
- [[ADR-004]] — Commercial Intelligence is owned by business, referenced by other modules

---

**Approved by:** Product Architecture  
**Approval date:** 2026-07-07
