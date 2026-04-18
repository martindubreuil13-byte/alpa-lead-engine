# ALPA Agent Mission Architecture Audit

## Scope audited

The current agent pipeline lives primarily across:

- `app/api/agent/setup/route.ts`
- `app/api/agent/confirm/route.ts`
- `app/api/agent/run-mission/route.ts`
- `app/api/agent/mission-status/route.ts`
- `app/api/agent/missions/update/route.ts`
- `app/api/agent/prepare-outreach/route.ts`
- `app/api/agent/generate-draft/route.ts`
- `lib/agent/run-mission.ts`
- `lib/agent/enrich-context.ts`
- `lib/agent/generate-outreach-draft.ts`
- `lib/agent/sync-agent-leads-to-main.ts`
- `lib/scraper/run-scraper-shared.ts`
- `supabase/migrations/20260412_add_agent_missions.sql`
- `supabase/migrations/20260412_add_agent_icp.sql`
- `supabase/migrations/20260416_extend_agent_missions.sql`
- `supabase/migrations/20260415_add_outreach_queue.sql`

## What exists today

### Mission creation

- Mission setup is split into two LLM-backed steps:
  - `POST /api/agent/setup` uses `gpt-4.1-mini` to generate `offer_context`, `icp_expanded`, `search_patterns`, and `allowed_categories`.
  - `POST /api/agent/confirm` creates an `agent_icp` row and an `agent_missions` row using those model outputs.
- Mission creation defaults the mission to `status: 'active'` immediately.
- There is no first-class schedule model for:
  - start now vs start later
  - mission timezone
  - daily local run time

### Mission execution

- The runtime entry point is `POST /api/agent/run-mission`.
- The route returns early and uses `after()` to do background work:
  1. `runMission()` in `lib/agent/run-mission.ts`
  2. `syncAgentLeadsToMain()`
  3. `runEmailPipeline()`
  4. `generateMissingDrafts()`
  5. `checkMissionCompletion()`
- There is no mission run table, no run log table, and no durable run-level lifecycle.
- Mission state is overloaded to represent both mission lifecycle and individual run state:
  - `active`
  - `running`
  - `completed`
  - `needs_review`
  - `stopped`
  - `exhausted`

### Scheduling

- There is no real scheduler.
- `computeNextRunAt()` in `app/api/agent/run-mission/route.ts` hardcodes the next run to `09:00 UTC` tomorrow.
- The UI still relies on manual user-triggered runs from `app/agent/dashboard/[missionId]/page.tsx`.
- “Recurring automation” is mostly a timestamp convention, not a real wake-run-sleep scheduler.

### ICP storage

- `agent_icp` stores raw input and a JSON blob of structured output.
- `agent_missions.icp_expanded` stores a JSON array of ICP variants.
- There is no first-class `mission_icps` table with deterministic rotation order, per-variant state, or per-variant query tracking.

### Scraper / lead discovery

- Mission execution calls `runSharedProspectorDiscovery()` from `lib/scraper/run-scraper-shared.ts`.
- In `mode: 'fast'`, the shared scraper primarily uses Serper, enriches websites, and returns leads with contact info.
- This deterministic scraper is the strongest part of the pipeline and should be reused.

### LLM usage

- `app/api/agent/setup/route.ts` uses OpenAI to generate ICP expansions and search patterns.
- `app/api/agent/icp/route.ts` uses OpenAI to generate ICP strategy JSON.
- `app/api/agent/generate-draft/route.ts` uses OpenAI to generate single drafts.
- `lib/agent/generate-outreach-draft.ts` uses OpenAI for outreach drafts and retries once if quality checks fail.
- Runtime lead scraping itself is mostly deterministic already, but the mission layer still behaves like an LLM-orchestrated system because:
  - search patterns originate from an LLM
  - query refinement logic is pseudo-agentic
  - the mission route performs too much orchestration in one request path

### Costly external APIs

- Serper is used in discovery.
- Google Places is used by the shared scraper in non-fast paths.
- OpenAI is used for setup and draft generation.
- Website fetching is used for deterministic email/context enrichment.
- Resend is used for sending approved outreach.

### Enrichment

- `lib/agent/enrich-context.ts` fetches homepage/contact/about pages for email recovery and website context.
- `lib/scraper/run-scraper-shared.ts` already does deterministic contact extraction/enrichment with bounded workers.
- `lib/agent/run-mission.ts` then adds a second mission-specific email recovery pass for no-email leads.

### Draft generation / review queue

- Drafts are stored in `outreach_queue`.
- Review actions live in:
  - `app/api/agent/outreach-queue/update/route.ts`
  - `app/api/agent/outreach-queue/send/route.ts`
  - `app/dashboard/outreach/page.tsx`
- This queue is reusable and already matches the desired “review before send” product behavior.

## What is working

- The deterministic discovery stack is real and reusable.
- The shared scraper already has sensible source escalation and deterministic enrichment.
- `outreach_queue` is a valid review queue foundation.
- `buildLeadKey()` and the dedupe migration show the team already understands that deterministic dedupe matters.
- The frontend mission surfaces are usable enough to preserve with backend changes.

## What is wasteful

### 1. The mission route is doing orchestration that should live in a run executor

- `app/api/agent/run-mission/route.ts` owns validation, locking, execution, syncing, draft generation, draft backfill, completion rules, and scheduling.
- That is too much responsibility for one route and makes failures hard to reason about.

### 2. Scheduling is fake

- The system claims recurring runs, but there is no actual scheduler waking due missions.
- The manual dashboard button is still the true control plane.
- Hardcoding “tomorrow at 09:00 UTC” is not timezone-safe and does not match user-configured local time.

### 3. Mission state is structurally wrong

- A mission should be long-lived and mostly dormant.
- A run should be short-lived and move through `queued -> running -> completed|partial|failed|cancelled`.
- Today those concerns are mixed together in `agent_missions.status`.

### 4. Query refinement is unnecessary complexity

- `lib/agent/run-mission.ts` contains low-yield retirement, injected refined queries, query memory, process-local cooldowns, and pseudo-agentic heuristics.
- This is complexity without durable run tracking.
- The product requirement is simpler: rotate deterministic ICP variants, fan out with bounded concurrency, stop at quota.

### 5. Runtime execution is sequential where it should be concurrent

- Current mission search runs one query at a time.
- Current email draft generation is sequential.
- Current missing-draft backfill adds another sequential pass.
- This increases latency and makes the system stay “thinking” longer than necessary.

### 6. Duplicate work exists between discovery and mission-specific enrichment

- The shared scraper already enriches contacts.
- The mission runner then performs another email recovery pass on no-email leads.
- For the current email-first mission flow, those no-email leads should usually be discarded early instead.

### 7. Draft generation coverage is achieved through backfill instead of cleaner acceptance rules

- `runEmailPipeline()` generates drafts for new leads.
- `generateMissingDrafts()` then performs a second pass over the entire mission queue.
- That is a patch over missing run-level ownership rather than a clean batch boundary.

## Where token/API spend is being wasted

### OpenAI

- One-time setup LLM calls may be acceptable, but the current system still uses LLM outputs as core discovery inputs.
- Draft generation does the right kind of work, but:
  - it retries per lead
  - it can generate again in a backfill pass
  - it is not tightly scoped to a run record

### Google / search spend

- The shared scraper has cost controls, but the mission layer is not optimized around the actual requirement:
  - email-first accepted leads
  - stop immediately at quota
  - fan out across variants deterministically
- Without a run lifecycle, cost controls are scattered instead of centralized.

### Latency spend

- The system pays time cost for:
  - sequential ICP query rounds
  - extra no-email recovery on leads we do not want
  - sequential enrichment for draft generation
  - sequential backfill for missing drafts

## What is structurally wrong

### No run table

- There is no durable record of:
  - when a run started
  - why it stopped
  - how many leads were discovered
  - how many were accepted
  - how many were deduped out
  - how many drafts were generated
  - whether the run failed or partially succeeded

### No durable logs

- Important execution details only exist in transient server logs.
- There is no admin-visible or DB-visible observability layer for runs.

### No true scheduler integration

- The product promise is automated daily execution.
- The implementation is still dashboard-driven.

### Mission/UI contract drift

- The code references `last_run_at` in UI and route updates, but the generated Supabase types and checked-in migrations do not define it.
- That is a clear schema drift signal.

## Recommended target architecture

### Keep

- `runSharedProspectorDiscovery()` as the deterministic discovery core.
- `outreach_queue` as the review queue.
- `generateOutreachDraft()` as the high-value LLM usage point.

### Refactor

- `agent_missions` into a mission definition + schedule record.
- runtime execution into a dedicated mission executor service.
- mission status APIs to derive UI state from mission + latest run instead of overloading mission status.

### Add

- `agent_mission_icps`
- `agent_mission_runs`
- `agent_mission_run_logs`
- explicit schedule fields on missions
- secure cron endpoint

### Remove from the hot path

- LLM-based scrape orchestration
- pseudo-agentic query refinement
- mission-level status transitions like `completed` for normal daily runs
- redundant no-email recovery for the email-first agent path

## Strategy choice

Best implementation path: isolate and rebuild the mission execution pipeline while preserving the existing mission setup screens and outreach review queue where feasible.

Reason:

- The current execution layer is too entangled to safely “tune”.
- The scraper and review queue are reusable.
- The orchestration and lifecycle model should be replaced, not patched.
