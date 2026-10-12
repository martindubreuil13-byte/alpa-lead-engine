import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  allSelected, BI_FILTER_LABEL, DEFAULT_FILTERS, deselectIds, describeRange, filtersFromSearch, filtersToSearch, hasActiveFilters,
  relativeTime, sameFilters, selectIds, SORT_LABEL, STATUS_CHIP, toggleId,
} from '../lib/my-leads/ui-state.ts'
import { BI_FILTERS, parseListParams, SORT_KEYS } from '../lib/my-leads/params.ts'
import { PROFILE_STATES } from '../lib/intelligence/run-progress.ts'

const read = (file) => readFileSync(file, 'utf8')
const components = readdirSync('components/my-leads').map((name) => `components/my-leads/${name}`)
const source = Object.fromEntries(components.map((file) => [file.split('/').pop().replace(/\.tsx?$/, ''), read(file)]))
const all = Object.values(source).join('\n')

// ------------------------------------------------------------------------------------------------------------ URL and filters
test('filters round-trip through the address bar, defaults are left out, and the same string reaches the endpoint', () => {
  assert.equal(filtersToSearch(DEFAULT_FILTERS).toString(), '')
  const filters = { q: 'toronto ai', city: 'Toronto', industry: 'IT consulting', contact: ['email', 'website'], bi: 'ready', sort: 'name', view: 'archived', page: 3, pageSize: 50 }
  const search = filtersToSearch(filters).toString()
  assert.deepEqual(filtersFromSearch(search), filters)
  assert.equal(sameFilters(filtersFromSearch(search), filters), true)
  // what the address bar carries is exactly what the endpoint validates and accepts
  const parsed = parseListParams(new URLSearchParams(search))
  assert.equal(parsed.ok, true)
  assert.deepEqual([parsed.params.view, parsed.params.sort, parsed.params.page, parsed.params.pageSize, parsed.params.bi, parsed.params.contact], ['archived', 'name', 3, 50, 'ready', ['email', 'website']])
})

test('a hand-edited or stale URL falls back to safe defaults and never throws', () => {
  const messy = filtersFromSearch('view=all&sort=random&bi=magic&contact=fax,email,email&page=-4&pageSize=100000&q=' + 'x'.repeat(500))
  assert.deepEqual([messy.view, messy.sort, messy.bi, messy.contact, messy.page, messy.pageSize], ['active', 'activity', '', ['email'], 1, 100])
  assert.equal(messy.q.length, 100)
  assert.deepEqual(filtersFromSearch(''), DEFAULT_FILTERS)
  assert.deepEqual(filtersFromSearch('page=abc&pageSize=0'), DEFAULT_FILTERS)
})

test('only real narrowing counts as an active filter (view, sort and page do not)', () => {
  assert.equal(hasActiveFilters(DEFAULT_FILTERS), false)
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, view: 'archived', sort: 'name', page: 4 }), false)
  for (const patch of [{ q: 'a' }, { city: 'a' }, { industry: 'a' }, { contact: ['email'] }, { bi: 'ready' }]) assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, ...patch }), true)
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, q: '   ' }), false)
})

test('every Business Intelligence filter and sort the endpoint accepts has a label, and every profile state has a status chip', () => {
  for (const value of BI_FILTERS) assert.ok(BI_FILTER_LABEL[value], value)
  assert.ok(BI_FILTER_LABEL[''])
  for (const value of SORT_KEYS) assert.ok(SORT_LABEL[value], value)
  for (const state of [...PROFILE_STATES, 'not_started']) assert.ok(STATUS_CHIP[state]?.label, state)
  assert.equal(STATUS_CHIP.ready.label, 'Profile ready')
  assert.equal(STATUS_CHIP.failed.tone, 'attention')
})

// ------------------------------------------------------------------------------------------------------------------ selection
test('a selection spans pages: select a page, move on, keep it; deselecting one page leaves the rest', () => {
  const page1 = ['a', 'b', 'c']
  const page2 = ['d', 'e']
  let selected = selectIds([], page1)
  assert.equal(allSelected(selected, page1), true)
  selected = selectIds(selected, page2)
  assert.deepEqual(selected, ['a', 'b', 'c', 'd', 'e'])
  assert.equal(allSelected(deselectIds(selected, page1), page1), false)
  assert.deepEqual(deselectIds(selected, page1), ['d', 'e'])
  assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(selectIds(['a'], ['a', 'b']), ['a', 'b']) // no duplicates
  assert.equal(allSelected([], []), false) // an empty page is not "all selected"
})

// ----------------------------------------------------------------------------------------------------------------------- words
test('ranges and times read plainly', () => {
  assert.equal(describeRange({ page: 1, pageSize: 25, count: 25, total: 1234 }), '1–25 of 1,234')
  assert.equal(describeRange({ page: 3, pageSize: 25, count: 10, total: 60 }), '51–60 of 60')
  assert.equal(describeRange({ page: 1, pageSize: 25, count: 0, total: 0 }), 'No businesses')
  const now = Date.parse('2026-10-12T12:00:00Z')
  assert.equal(relativeTime('2026-10-12T11:59:40Z', now), 'Just now')
  assert.equal(relativeTime('2026-10-12T11:15:00Z', now), '45 min ago')
  assert.equal(relativeTime('2026-10-12T09:00:00Z', now), '3 h ago')
  assert.equal(relativeTime('2026-10-11T08:00:00Z', now), 'Yesterday')
  assert.equal(relativeTime('2026-10-08T12:00:00Z', now), '4 d ago')
  assert.equal(relativeTime(null, now), 'No activity')
  assert.equal(relativeTime('not a date', now), 'No activity')
})

// ---------------------------------------------------------------------------------------------------- performance and security
test('the workspace uses the paginated endpoints only: no database client, no full-library read, no research request', () => {
  assert.match(source.useLeadList, /fetch\(`\/api\/my-leads\$\{query \? `\?\$\{query\}` : ''\}`/)
  assert.match(source.LeadDossier, /fetch\(`\/api\/my-leads\/\$\{id\}`/)
  assert.match(source.MyLeadsWorkspace, /fetch\('\/api\/my-leads\/export'/)
  assert.ok(!/supabase|createClient|createBrowserClient|\.from\(|SERVICE_ROLE|createAdminClient/.test(all), 'no direct database access from the browser components')
  assert.ok(!/process-ci|enrich-commercial|research-control|\/api\/research|setInterval\(|visibilitychange/.test(all), 'nothing here starts or polls research')
  const page = read('app/dashboard/my-leads/page.tsx')
  assert.ok(!/LEAD_SELECT|\.from\(|jobsResult|commercial_profile/.test(page))
  assert.match(page, /getUserProfile\(\)[\s\S]*redirect\('\/login'\)/)
  assert.match(page, /<Suspense/)
})

test('the full business is fetched only when its row is opened', () => {
  assert.match(source.LeadRow, /\{expanded \? \(/)
  assert.match(source.LeadRow, /\{children\}/)
  assert.match(source.MyLeadsWorkspace, /<LeadDossier\s+id=\{item\.id\}/)
  assert.ok(!/fetch\(/.test(source.LeadRow) && !/fetch\(/.test(source.OverviewStrip) && !/fetch\(/.test(source.CommandBar))
  assert.match(source.MyLeadsWorkspace, /setExpandedId\(\(current\) => \(current === item\.id \? null : item\.id\)\)/) // one open at a time
})

test('search is debounced, every filter returns to page one, and the filters live in the URL', () => {
  assert.match(source.CommandBar, /const DEBOUNCE_MS = 300/)
  assert.match(source.CommandBar, /setTimeout\(\(\) => latest\.current\(\{ \.\.\.text, page: 1 \}\), DEBOUNCE_MS\)/)
  assert.match(source.CommandBar, /clearTimeout\(timer\)/)
  assert.ok((source.CommandBar.match(/page: 1/g) ?? []).length >= 5)
  assert.match(source.MyLeadsWorkspace, /router\.replace\(/)
  assert.match(source.MyLeadsWorkspace, /useSearchParams\(\)/)
  assert.match(source.MyLeadsWorkspace, /scroll: false/)
  assert.match(source.useLeadList, /controller\.abort\(\)/) // a newer request cancels an older one
})

// ---------------------------------------------------------------------------------------------------------------------- actions
test('the actions that belong in the dossier are all there: archive, restore, delete (single and bulk, confirmed), CSV export, copy', () => {
  const workspace = source.MyLeadsWorkspace
  assert.match(workspace, /import \{ archiveLeads, deleteLead, deleteLeads, restoreLeads \} from '@\/app\/dashboard\/my-leads\/actions'/)
  for (const call of ['archiveLeads(ids)', 'restoreLeads(ids)', 'deleteLead(ids[0])', 'deleteLeads(ids)']) assert.ok(workspace.includes(call), call)
  assert.match(workspace, /Delete permanently\?/) // deletion is always confirmed
  assert.match(workspace, /setConfirmDelete\(\[item\.id\]\)/)
  assert.match(workspace, /downloadLeadCsv\(data\.leads, getLeadCsvFilename\('my-leads'\)\)/)
  assert.match(workspace, /Export CSV/)
  assert.match(workspace, /navigator\.clipboard\.writeText/)
  assert.match(source.LeadDossier, /aria-label=\{`Copy \$\{label\.toLowerCase\(\)\}`\}/)
  for (const label of ['Archive', 'Restore', 'Delete permanently']) assert.ok(source.LeadDossier.includes(label), label)
  // a failed action is rolled back and said so
  assert.match(workspace, /if \(!result\.success\) \{[\s\S]*showToast\(failure, 'error'\)/)
  // the server actions themselves are untouched and still owner-scoped
  const actions = read('app/dashboard/my-leads/actions.ts')
  assert.equal((actions.match(/\.eq\('user_id', profile\.id\)/g) ?? []).length >= 4, true)
})

test('archived businesses offer Restore and Delete; active ones offer Archive; bulk matches the view', () => {
  assert.match(source.LeadDossier, /\{archived \? \(/)
  assert.match(source.MyLeadsWorkspace, /archivedView \? \(/)
  assert.match(source.MyLeadsWorkspace, /Restore/)
})

// ----------------------------------------------------------------------------------------------------------------- structure
test('the workspace structure: header, overview, command bar, list, dossier sections, and an honest "coming soon" entry', () => {
  const workspace = source.MyLeadsWorkspace
  assert.match(workspace, /<h1[^>]*>My Leads<\/h1>/)
  assert.match(workspace, /<OverviewStrip/)
  assert.match(workspace, /<CommandBar/)
  for (const heading of ['Business overview', 'Business Intelligence', 'Commercial opportunities', 'Business signals', 'Contact information', 'Notes and actions']) assert.ok(source.LeadDossier.includes(heading), heading)
  for (const label of ['Businesses', 'Profiles ready', 'Awaiting intelligence', 'Need attention']) assert.ok(source.OverviewStrip.includes(label), label)
  assert.match(source.ConnectTools, /Connect your tools/)
  assert.match(source.ConnectTools, /Coming soon/)
  assert.ok(!/href=|fetch\(|router\./.test(source.ConnectTools), 'the entry point connects to nothing')
  assert.match(source.ConnectTools, /None of these are available yet/)
})

test('sections with nothing behind them are left out; nothing is invented', () => {
  assert.match(source.LeadDossier, /hasOpportunities = Boolean\(profile && \(profile\.core_services\.length \|\| profile\.target_customer\)\)/)
  assert.match(source.LeadDossier, /\{hasOpportunities && profile \? \(/)
  assert.match(source.LeadDossier, /card\?\.facts\.signals\.length \? \(/)
  assert.match(source.LeadDossier, /No contact details were found for this business\./)
  assert.match(source.LeadDossier, /No notes yet\./)
  assert.match(source.LeadDossier, /STATE_TEXT\[intelligence\.state\]/) // a business with no profile says why, from its real state
  assert.ok(!/competitive_advantage|website_snapshot|business_signals/.test(source.LeadDossier), 'raw payloads and unverifiable claims are not rendered')
})

test('keyboard, screen-reader and reduced-motion support', () => {
  assert.match(source.LeadRow, /aria-expanded=\{expanded\}/)
  assert.match(source.LeadRow, /aria-controls=\{panelId\}/)
  assert.match(source.LeadRow, /role="region"/)
  assert.match(source.LeadRow, /aria-label=\{`Select \$\{item\.company_name\}`\}/)
  assert.match(source.LeadRow, /motion-safe:animate-pulse/)
  assert.match(source.OverviewStrip, /aria-pressed/)
  assert.match(source.CommandBar, /role="tablist"/)
  assert.match(source.CommandBar, /aria-pressed=\{on\}/)
  assert.match(source.MyLeadsWorkspace, /role="toolbar"/)
  assert.match(source.MyLeadsWorkspace, /aria-live="polite"/)
  assert.match(source.MyLeadsWorkspace, /role="dialog" aria-modal="true"/)
})

test('unrelated surfaces are untouched: Discover, research code, billing and credits', () => {
  for (const file of ['app/api/scrape/route.ts', 'app/dashboard/scraper/page.tsx', 'lib/commercial-intelligence/kick-research.ts', 'lib/commercial-intelligence/run-authorization.ts', 'lib/scraper/save-discover-results.ts']) {
    assert.ok(!/components\/my-leads|lib\/my-leads/.test(read(file)), file)
  }
})

test('there is no "Open profile": the whole business is read inline, and nothing in My Leads leads to the legacy lead composer', () => {
  assert.ok(!/Open profile|onOpenProfile|ExternalLink/.test(all), 'the misleading action and its wiring are gone')
  assert.ok(!/dashboard\/leads\//.test(all), 'no link or navigation into the legacy lead-management / email-composer page')
  assert.ok(!/router\.push\(/.test(all), 'the workspace replaces the address (filters) but never navigates away')
  // the complete dossier is still available inline when a row is expanded
  for (const section of ['Business overview', 'Contact information', 'Business Intelligence', 'Notes and actions']) assert.ok(source.LeadDossier.includes(section), section)
  assert.match(source.MyLeadsWorkspace, /<LeadDossier\s+id=\{item\.id\}/)
  assert.match(source.LeadRow, /\{expanded \? \(/)
  // the legacy page and its email sending are not touched by this change
  assert.ok(existsSync('app/dashboard/leads/[id]/page.tsx'))
  assert.match(read('app/dashboard/leads/[id]/page.tsx'), /\/api\/send-email/)
})
