import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyProgressEvent,
  INITIAL_DISCOVERY_PROGRESS,
} from '../lib/scraper/discover-progress.ts'
import {
  buildSearchFailure,
  classifyHttpStatus,
  classifyThrown,
  isFatalSearchLog,
  resolveSearchOutcome,
} from '../lib/scraper/search-failure.ts'

const page = readFileSync(new URL('../app/dashboard/scraper/page.tsx', import.meta.url), 'utf8')

// ---------- outcome classification ----------

test('fatal server events are recognized, ordinary logs are not', () => {
  assert.equal(isFatalSearchLog('❌ fatal: something broke'), true)
  assert.equal(isFatalSearchLog('❌ invalid input'), true)
  assert.equal(isFatalSearchLog('❌ missing authenticated user'), true)
  assert.equal(isFatalSearchLog('⚠️ duplicate skipped: Acme'), false)
  assert.equal(isFatalSearchLog('❌ db error: Acme | code=23505'), false) // a per-business save error, not a failed search
})

test('fatal server event: shown as a generic failure, never the raw message', () => {
  const outcome = resolveSearchOutcome({ resultConfirmed: false, fatalSeen: true })
  assert.deepEqual(outcome, { status: 'failed', kind: 'server' })
  const failure = buildSearchFailure('server')
  assert.equal(failure.title, 'We couldn’t finish this search.')
  assert.doesNotMatch(JSON.stringify(failure), /fatal|stack|postgres|supabase|code=|error:/i)
})

test('quota rejection (HTTP 403) is distinguished and does not offer a pointless retry', () => {
  const outcome = resolveSearchOutcome({ resultConfirmed: false, httpStatus: 403 })
  assert.deepEqual(outcome, { status: 'failed', kind: 'quota' })
  const failure = buildSearchFailure('quota')
  assert.match(failure.title, /plan limit/)
  assert.ok(failure.actions.includes('billing'))
  assert.ok(!failure.actions.includes('retry'))
  assert.doesNotMatch(failure.body, /saved before the interruption/) // nothing ran
})

test('signed-out rejection (HTTP 401) asks the customer to sign in', () => {
  const outcome = resolveSearchOutcome({ resultConfirmed: false, httpStatus: 401 })
  assert.deepEqual(outcome, { status: 'failed', kind: 'auth' })
  assert.deepEqual(buildSearchFailure('auth').actions, ['sign-in'])
})

test('other HTTP errors are a generic server failure; success statuses are not failures', () => {
  assert.equal(classifyHttpStatus(500), 'server')
  assert.equal(classifyHttpStatus(404), 'server')
  assert.equal(classifyHttpStatus(200), null)
})

test('network failure and other thrown errors are classified without exposing details', () => {
  assert.equal(classifyThrown(new TypeError('Failed to fetch')), 'network')
  assert.equal(classifyThrown(new Error('network connection lost')), 'network')
  assert.equal(classifyThrown(new Error('relation "leads" does not exist')), 'interrupted')
  const outcome = resolveSearchOutcome({ resultConfirmed: false, thrown: new TypeError('Failed to fetch') })
  assert.deepEqual(outcome, { status: 'failed', kind: 'network' })
  const failure = buildSearchFailure('network')
  assert.doesNotMatch(JSON.stringify(failure), /fetch|relation|TypeError|Failed to/i)
})

test('stream ends without a result event is a recoverable failure, not completion', () => {
  assert.deepEqual(resolveSearchOutcome({ resultConfirmed: false }), { status: 'failed', kind: 'no_result' })
  const failure = buildSearchFailure('no_result')
  assert.deepEqual(failure.actions, ['my-leads', 'retry'])
  assert.equal(failure.body, 'Some businesses may have been saved before the interruption. Check My Leads before trying again.')
})

test('partial saves before the interruption are reported with the real count', () => {
  const progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, {
    type: 'progress',
    stage: 'saving',
    considered: 10,
    processed: 4,
    saved: 4,
    duplicates: 0,
    invalid: 0,
    failed: 0,
  })
  const failure = buildSearchFailure('no_result', { savedCount: progress.saves.saved })
  assert.equal(failure.body, '4 businesses were saved before the interruption. Check My Leads before trying again.')
  assert.match(buildSearchFailure('network', { savedCount: 1 }).body, /^1 business was saved/)
})

test('successful completion always wins: a late error is never shown as a failure', () => {
  assert.deepEqual(resolveSearchOutcome({ resultConfirmed: true, thrown: new TypeError('Failed to fetch') }), { status: 'completed' })
  assert.deepEqual(resolveSearchOutcome({ resultConfirmed: true, fatalSeen: true }), { status: 'completed' })
  assert.deepEqual(resolveSearchOutcome({ resultConfirmed: true, httpStatus: 500 }), { status: 'completed' })
})

test('a deliberate stop by the customer is not an error', () => {
  assert.deepEqual(resolveSearchOutcome({ resultConfirmed: false, aborted: true }), { status: 'aborted' })
})

test('failures that need a retry offer View My Leads and Try again; the customer chooses', () => {
  for (const kind of ['server', 'network', 'interrupted', 'no_result']) {
    assert.deepEqual(buildSearchFailure(kind).actions, ['my-leads', 'retry'], kind)
  }
})

// ---------- page wiring ----------

test('the notice is rendered outside the loading-only panel and persists after loading ends', () => {
  assert.match(page, /\{searchFailure && !loading \? \(\s*<SearchFailureNotice/)
  // the live panel is a separate branch
  assert.match(page, /const isLive = loading && !completionResult/)
  assert.match(page, /\{showEngine \? \(\s*<DiscoverEngine/)
  // never shown once a result is confirmed
  assert.match(page, /searchFailureKind && !completionResult/)
})

test('the notice is announced to screen readers and shows no raw errors', () => {
  const notice = page.slice(page.indexOf('function SearchFailureNotice'), page.indexOf('export default function Page'))
  assert.match(notice, /role="alert"/)
  assert.match(notice, /aria-atomic="true"/)
  assert.match(notice, /View My Leads/)
  assert.match(notice, /Try again/)
  assert.match(notice, /focus-visible:outline/)
  assert.doesNotMatch(notice, /error\.message|\.stack|JSON\.stringify|dangerouslySetInnerHTML/)
  // the notice is hairline-styled, not a large warning card
  assert.doesNotMatch(notice, /bg-(red|rose|amber)-|shadow-\[|rounded-\[(2|3)\dpx\]|animate-/)
})

test('retry is manual, keeps the inputs, and a new search clears the error', () => {
  assert.match(page, /onRetry=\{\(\) => void runScrape\(\)\}/) // only on click, current inputs
  assert.match(page, /setLoading\(true\)\s*\n[\s\S]{0,160}setSearchFailureKind\(null\)/) // cleared when a new run begins
  assert.match(page, /setCompletionResult\(null\)\s*\n\s*setSearchFailureKind\(null\)/) // and on a full reset
  const failure = page.slice(page.indexOf('const failSearch'), page.indexOf('const failSearch') + 260)
  assert.doesNotMatch(failure, /runScrape/) // no automatic retry
  assert.doesNotMatch(page, /setTimeout\([^)]*runScrape/)
  // failures never reset the customer's inputs
  const start = page.indexOf('const failSearch')
  const failBlock = page.slice(start, page.indexOf('\n    }\n', start))
  assert.doesNotMatch(failBlock, /setBusinessType|setCity|setRegion|setCountry|resetSearchFlow/)
})

test('every failure path records a failure and stops the live state', () => {
  // HTTP rejection (quota / signed out) before any streaming
  assert.match(page, /if \(!res\.ok\) \{[\s\S]*?resolveSearchOutcome\(\{ resultConfirmed: false, httpStatus: res\.status \}\)[\s\S]*?finish\('Mission failed\.'\)[\s\S]*?return/)
  // fatal event
  assert.match(page, /if \(isFatalSearchLog\(msg\)\) \{\s*fatalSeen = true\s*failSearch\('server'\)\s*finish\('Mission failed\.'\)/)
  // stream ended without a result
  assert.match(page, /if \(!latestResult\) \{\s*const outcome = resolveSearchOutcome\(\{ resultConfirmed: resultHandled, fatalSeen \}\)/)
  // thrown (network) errors
  assert.match(page, /resolveSearchOutcome\(\{ resultConfirmed: resultHandled, thrown: error \}\)/)
  // the first failure wins; a confirmed result blocks any failure
  assert.match(page, /const failSearch = \(kind: SearchFailureKind\) => \{\s*if \(resultHandled\) return\s*setSearchFailureKind\(\(current\) => current \?\? kind\)/)
})

test('raw server response bodies are never surfaced', () => {
  const run = page.slice(page.indexOf('async function runScrape'), page.indexOf('function abortMission'))
  assert.doesNotMatch(run, /res\.text\(\)|errorText/)
})

test('a result is still processed exactly once and a late error does not undo it', () => {
  assert.equal((page.match(/let resultHandled = false/g) || []).length, 1)
  assert.match(page, /const handleResult = \(result: ScrapeResultPayload\) => \{\s*if \(resultHandled\) return\s*resultHandled = true/)
  assert.match(page, /if \(outcome\.status === 'completed'\) \{\s*return\s*\}/)
})

test('plan-limit failures link to Plan & Billing and are distinguished by the API status code', () => {
  assert.match(page, /href="\/dashboard\/billing"/)
  assert.match(page, /failure\.actions\.includes\('billing'\)/)
})
