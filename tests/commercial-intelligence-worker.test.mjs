import assert from 'node:assert/strict'
import test from 'node:test'

import { runBackgroundWorkerCore } from '../lib/commercial-intelligence/background-worker-core.ts'
import { isCommercialIntelligenceCronAuthorized } from '../lib/commercial-intelligence/cron-auth.ts'
import { isPrivatePreviewWorkerRequest } from '../lib/commercial-intelligence/private-preview.ts'
import {
  getPrivatePreviewResearchStatus,
  mergePrivatePreviewResearch,
  shouldRefreshPrivatePreviewResearch,
} from '../lib/commercial-intelligence/private-preview-research.ts'
import { buildLeadCsv } from '../lib/leads/csv.ts'

const client = {}

function item(number, retryCount = 0) {
  return {
    id: `queue-${number}`,
    lead_id: `lead-${number}`,
    status: 'processing',
    retry_count: retryCount,
    max_retries: 3,
    created_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    completed_at: null,
    last_error: null,
    last_retry_at: null,
    claim_token: `token-${number}`,
  }
}

function enrichment(leadId) {
  return {
    success: true,
    leadId,
    website_snapshot: { source_urls: ['https://example.com'] },
    business_signals: {},
    commercial_profile: { summary: 'Mock profile' },
    ci_enrichment_status: 'completed',
    ci_started_at: new Date(0).toISOString(),
    ci_completed_at: new Date(0).toISOString(),
    ci_last_error: null,
    ci_retry_count: 0,
    ci_processing_duration_ms: 10,
    ci_cost_estimate: 0.001,
    ci_model_versions: { snapshot: 'v1', signals: 'v1', profile: 'mock' },
  }
}

function dependencies(overrides = {}) {
  return {
    recover: async () => ({ resetCount: 0, failedCount: 0 }),
    claim: async () => [item(1)],
    enrich: async (leadId) => enrichment(leadId),
    complete: async () => ({ ok: true, nextStatus: 'enrichment_completed' }),
    ...overrides,
  }
}

test('processes and stores a successful claimed job', async () => {
  let completion
  const result = await runBackgroundWorkerCore(client, dependencies({
      complete: async (...args) => {
        completion = args
        return { ok: true, nextStatus: 'enrichment_completed' }
      },
    }))

  assert.equal(result.completed, 1)
  assert.equal(result.estimatedCost, 0.001)
  assert.equal(completion[1].claim_token, 'token-1')
})

test('processes concurrent claims once without duplicate work', async () => {
  const processed = new Map()
  const result = await runBackgroundWorkerCore(client, dependencies({
      claim: async () => [item(1), item(2), item(3), item(4)],
      enrich: async (leadId) => {
        processed.set(leadId, (processed.get(leadId) || 0) + 1)
        return enrichment(leadId)
      },
    }), { concurrency: 4 })

  assert.equal(result.claimed, 4)
  assert.deepEqual([...processed.values()], [1, 1, 1, 1])
})

test('rejects a duplicate or expired claim completion', async () => {
  const result = await runBackgroundWorkerCore(client, dependencies({
    complete: async () => ({ ok: false, nextStatus: 'claim_lost' }),
  }))

  assert.equal(result.results[0].status, 'claim_lost')
  assert.equal(result.completed, 0)
})

test('records temporary failures for bounded retry', async () => {
  const result = await runBackgroundWorkerCore(client, dependencies({
      enrich: async () => {
        throw new Error('temporary upstream timeout')
      },
      complete: async (_client, _item, _snapshot, _signals, _profile, success) => {
        assert.equal(success, false)
        return { ok: true, nextStatus: 'retry_pending' }
      },
    }))

  assert.equal(result.retrying, 1)
})

test('records permanent failure after retry limit', async () => {
  const result = await runBackgroundWorkerCore(client, dependencies({
      claim: async () => [item(1, 2)],
      enrich: async () => {
        throw new Error('permanent failure')
      },
      complete: async () => ({ ok: true, nextStatus: 'enrichment_failed' }),
    }))

  assert.equal(result.failed, 1)
})

test('leaves an interrupted completion for stale recovery', async () => {
  const result = await runBackgroundWorkerCore(client, dependencies({
      enrich: async () => {
        throw new Error('worker interrupted')
      },
      complete: async () => {
        throw new Error('database unavailable')
      },
    }))

  assert.equal(result.interrupted, 1)
})

test('reports stale recovery results before claiming new work', async () => {
  const calls = []
  const result = await runBackgroundWorkerCore(client, dependencies({
      recover: async () => {
        calls.push('recover')
        return { resetCount: 1, failedCount: 1 }
      },
      claim: async () => {
        calls.push('claim')
        return []
      },
    }))

  assert.deepEqual(calls, ['recover', 'claim'])
  assert.equal(result.recovered, 1)
  assert.equal(result.permanentlyFailedDuringRecovery, 1)
})

test('rejects unauthorized cron requests', () => {
  const unauthorized = new Request('https://example.com/worker')
  const authorized = new Request('https://example.com/worker', {
    headers: { authorization: 'Bearer test-secret' },
  })

  assert.equal(isCommercialIntelligenceCronAuthorized(unauthorized, 'test-secret'), false)
  assert.equal(isCommercialIntelligenceCronAuthorized(authorized, 'test-secret'), true)
  assert.equal(isCommercialIntelligenceCronAuthorized(authorized, ''), false)
})

test('only the configured owner can mark private-preview work as eligible', () => {
  const ownerId = 'owner-user-id'

  assert.equal(isPrivatePreviewWorkerRequest(true, ownerId, ownerId), true)
  assert.equal(isPrivatePreviewWorkerRequest(true, 'another-user', ownerId), false)
  assert.equal(isPrivatePreviewWorkerRequest(false, ownerId, ownerId), false)
  assert.equal(isPrivatePreviewWorkerRequest(true, ownerId, ''), false)
})

test('shows pending research and then merges a ready synopsis', () => {
  const lead = {
    id: 'lead-1',
    company_name: 'Example Co',
    city: 'Toronto',
    industry: null,
    email: null,
    email_source: null,
    is_generic_email: false,
    phone: null,
    website: 'https://example.com',
    status: 'new',
    pipeline_stage: null,
    close_reason: null,
    source: null,
    cost_estimate: null,
    created_at: new Date(0).toISOString(),
    ci_enrichment_status: 'pending',
    commercial_profile: null,
  }

  assert.equal(getPrivatePreviewResearchStatus(lead), 'researching')
  assert.equal(shouldRefreshPrivatePreviewResearch([lead]), true)

  const [updated] = mergePrivatePreviewResearch([lead], [{
    id: lead.id,
    ci_enrichment_status: 'completed',
    ci_completed_at: new Date(1).toISOString(),
    ci_last_error: null,
    commercial_profile: { summary: 'A factual completed business synopsis.' },
  }])

  assert.equal(getPrivatePreviewResearchStatus(updated), 'ready')
  assert.equal(shouldRefreshPrivatePreviewResearch([updated]), false)
})

test('shows unavailable when research finishes without a reliable synopsis', () => {
  assert.equal(getPrivatePreviewResearchStatus({
    ci_enrichment_status: 'failed',
    commercial_profile: null,
  }), 'unavailable')
})

test('CSV remains available before research and includes synopsis afterward', () => {
  const lead = {
    company_name: 'No Contact Co',
    city: 'Montreal',
    email: null,
    phone: null,
    website: 'https://example.com',
    commercial_profile: null,
    ci_completed_at: null,
  }
  const before = buildLeadCsv([lead])
  const after = buildLeadCsv([{
    ...lead,
    commercial_profile: { summary: 'The company provides clearly documented services to customers in its stated market.' },
    ci_completed_at: new Date(0).toISOString(),
  }])

  assert.match(before, /"No Contact Co","","","https:\/\/example.com"/)
  assert.doesNotMatch(before, /clearly documented services/)
  assert.match(after, /clearly documented services/)
})

// ---- Chunk 7B ----
import { readFileSync } from 'node:fs'
import { WORKER_DEFAULTS, resolveWorkerConfig } from '../lib/commercial-intelligence/worker-config.ts'
import { OPENAI_PROFILE_REQUEST_OPTIONS } from '../lib/commercial-intelligence/commercial-profile-core.ts'
import { findExistingOwnerLeadId } from '../lib/commercial-intelligence/private-preview.ts'

test('worker defaults are conservative and adjustable by env', () => {
  assert.deepEqual(resolveWorkerConfig({}), { batchSize: 2, concurrency: 1, staleTimeoutSeconds: 600 })
  assert.deepEqual(
    resolveWorkerConfig({ CI_WORKER_BATCH_SIZE: '8', CI_WORKER_CONCURRENCY: '3', CI_WORKER_STALE_SECONDS: '900' }),
    { batchSize: 8, concurrency: 3, staleTimeoutSeconds: 900 }
  )
  assert.equal(resolveWorkerConfig({ CI_WORKER_BATCH_SIZE: '999' }).batchSize, 20)
  assert.equal(resolveWorkerConfig({ CI_WORKER_BATCH_SIZE: 'abc' }).batchSize, WORKER_DEFAULTS.batchSize)
})

test('core uses the conservative defaults when no options are given', async () => {
  let claimLimit
  let staleSeconds
  await runBackgroundWorkerCore(client, dependencies({
    claim: async (_c, limit) => { claimLimit = limit; return [] },
    recover: async (_c, seconds) => { staleSeconds = seconds; return { resetCount: 0, failedCount: 0 } },
  }))
  assert.equal(claimLimit, 2)
  assert.equal(staleSeconds, 600)
})

test('OpenAI profile request is time-bounded without SDK retries', () => {
  assert.equal(OPENAI_PROFILE_REQUEST_OPTIONS.timeout, 30_000)
  assert.equal(OPENAI_PROFILE_REQUEST_OPTIONS.maxRetries, 0)
  const source = readFileSync(new URL('../lib/commercial-intelligence/generate-commercial-profile.ts', import.meta.url), 'utf8')
  assert.match(source, /OPENAI_PROFILE_REQUEST_OPTIONS\)/)
})

test('private-preview polling is 20s and only runs for private preview', () => {
  const source = readFileSync(new URL('../app/dashboard/scraper/page.tsx', import.meta.url), 'utf8')
  assert.match(source, /PRIVATE_PREVIEW_POLL_INTERVAL_MS = 20_000/)
  assert.doesNotMatch(source, /refreshResearch, 5_000/)
  assert.match(source, /hasPendingPrivateResearch =\s*\n\s*privatePreview &&/)
})

test('rediscovery lookup is scoped to the owner and one business', async () => {
  const calls = []
  const mock = {
    from: () => {
      const filters = {}
      const q = {
        select: () => q,
        eq: (col, val) => { filters[col] = val; return q },
        limit: async () => { calls.push({ ...filters }); return { data: filters.website === 'https://a.example' ? [{ id: 'lead-a' }] : [], error: null } },
      }
      return q
    },
  }
  assert.equal(await findExistingOwnerLeadId(mock, 'owner', { website: 'https://a.example', company_name: 'A' }), 'lead-a')
  assert.ok(calls.every((c) => c.user_id === 'owner'))
  assert.equal(await findExistingOwnerLeadId(mock, 'owner', { website: 'https://zzz.example' }), null)
})

test('only private-preview enqueue uses the service-role RPC; public path inserts ineligible rows', () => {
  const src = readFileSync(new URL('../lib/commercial-intelligence/queue-manager.ts', import.meta.url), 'utf8')
  assert.match(src, /options\.workerEligible === true/)
  assert.match(src, /enqueue_private_preview_ci_worker/)
  const start = src.indexOf('const payload = {')
  assert.doesNotMatch(src.slice(start, start + 160), /worker_eligible/)
  const route = readFileSync(new URL('../app/api/scrape/route.ts', import.meta.url), 'utf8')
  assert.match(route, /saved\.reason === 'duplicate' && config\.workerEligible/)
})

test('migration guards worker_eligible and keeps claim-token protection', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261008_add_ci_background_worker.sql', import.meta.url), 'utf8')
  assert.match(sql, /trg_guard_ci_queue_worker_eligible/)
  assert.match(sql, /claim_token = p_claim_token/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION enqueue_private_preview_ci_worker\(UUID, UUID\) TO service_role/)
})

// ---- Chunk 8C: security repair migration shape ----
test('security migration enables RLS on all 12 tables and never grants client writes on profiles', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261009_secure_exposed_public_tables.sql', import.meta.url), 'utf8')
  for (const table of ['profiles','users','subscriptions','usage','user_usage','sender_settings','app_settings','email_templates','email_events','agent_emails','agent_mission_runs','agent_mission_icps']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`))
  }
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*public\.profiles/)
  assert.doesNotMatch(sql, /ON public\.profiles\s+FOR (INSERT|UPDATE|DELETE|ALL)/)
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(code, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\./)
})
