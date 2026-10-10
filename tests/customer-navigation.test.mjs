import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(root, p), 'utf8')

function routeFiles(dir) {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory()) out.push(...routeFiles(rel))
    else if (name === 'route.ts') out.push(rel)
  }
  return out
}

function labels(source, constName) {
  const block = source.slice(source.indexOf(`const ${constName}`), source.indexOf(']\n', source.indexOf(`const ${constName}`)))
  return [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
}

const shell = read('components/dashboard/DashboardShell.tsx')

test('customer sidebar has exactly the four approved entries, in order', () => {
  assert.deepEqual(labels(shell, 'NAV_ITEMS'), ['Dashboard', 'Discover', 'My Leads', 'Plan & Billing'])
})

test('administrator navigation keeps Analytics, Lead Capture, Users and System', () => {
  assert.deepEqual(labels(shell, 'ADMIN_NAV_ITEMS'), ['Analytics', 'Lead Capture', 'Users', 'System'])
})

test('retired customer pages are guarded server-side by a shared admin layout', () => {
  for (const dir of ['app/dashboard/templates', 'app/dashboard/outreach', 'app/dashboard/library', 'app/dashboard/enrich', 'app/dashboard/kanban', 'app/agent', 'app/(agent-lab)/agent-mode']) {
    const layout = read(`${dir}/layout.tsx`)
    assert.match(layout, /await requireAdminPage\(\)/, dir)
  }
})

test('retained customer pages and the private preview are not behind the admin guard', () => {
  for (const dir of ['app/dashboard', 'app/dashboard/scraper', 'app/dashboard/my-leads', 'app/dashboard/billing', 'app/dashboard/settings', 'app/dashboard/alpa-preview']) {
    assert.ok(existsSync(join(root, dir, 'page.tsx')), `${dir} page exists`)
    const layoutPath = join(root, dir, 'layout.tsx')
    if (existsSync(layoutPath)) assert.doesNotMatch(readFileSync(layoutPath, 'utf8'), /requireAdminPage/, dir)
  }
})

test('every retired API rejects non-admins server-side', () => {
  const dirs = ['app/api/agent', 'app/api/outreach', 'app/api/pipeline-automation', 'app/api/send-email', 'app/api/debug-email']
  const files = dirs.flatMap((d) => routeFiles(d))
  assert.ok(files.length >= 20)
  for (const f of files) {
    assert.match(read(f), /adminGuard\(|requireAdmin\(/, `${f} must check for an administrator`)
  }
})

test('administrator pages and APIs keep their server-side authorization', () => {
  for (const p of ['activity', 'lead-capture', 'users', 'system']) {
    assert.match(read(`app/admin/${p}/page.tsx`), /!isAdmin\(profile\)/, p)
  }
  for (const f of routeFiles('app/api/admin')) {
    assert.match(read(f), /requireAdmin|isAdmin\(|ADMIN_EMAIL|x-admin-secret/, f)
  }
})

test('pipeline, templates and email features are administrator-only', () => {
  const access = read('lib/auth/access.ts')
  assert.match(access, /feature === 'pipeline' \|\| feature === 'templates' \|\| feature === 'email'\) return isAdmin\(user\)/)
})

test('customer Settings renders no sender configuration; administrators keep it', () => {
  const page = read('app/dashboard/settings/page.tsx')
  assert.match(page, /if \(!isAdmin\(profile\)\) redirect\('\/dashboard\/billing'\)/)
  assert.match(page, /return <SenderSettingsPanel \/>/)
  assert.doesNotMatch(page, /sender_settings|\/api\/send-email/)
  assert.ok(existsSync(join(root, 'app/dashboard/settings/SenderSettingsPanel.tsx')))
})

test('lead detail page shows no composer, template or campaign UI to customers', () => {
  const page = read('app/dashboard/leads/[id]/page.tsx')
  assert.match(page, /const showComposer = !profileLoading && isAdmin\(profile\)/)
  // composer, template list and send controls only render behind showComposer
  assert.match(page, /\{!showComposer \? null : setupLoading \?/)
  assert.match(page, /\{showComposer \? \(\s*<FeatureLockModal/)
  // the email/template data is never fetched for customers
  assert.match(page, /if \(!showComposer\) \{\s*setSetupLoading\(false\)\s*return\s*\}\s*void fetchEmailSetup\(\)/)
  // customer-visible header copy does not mention composing email
  assert.match(page, /showComposer \? 'Email Composer' : lead\.company_name/)
})

test('every route that sends email is either admin-only or the restricted transactional endpoint', () => {
  const senders = routeFiles('app/api').filter((f) => /api\.resend\.com\/emails|emails\.send\(/.test(read(f)))
  assert.ok(senders.length >= 5)
  for (const f of senders) {
    if (f.endsWith('results-email/route.ts')) continue
    assert.match(read(f), /adminGuard\(|requireAdmin\(/, `${f} sends email and must be admin-only`)
  }
})

test('no customer-facing page offers to email results or compose email', () => {
  const customerFiles = [
    'app/dashboard/scraper/page.tsx',
    'app/dashboard/leads/LeadsPageClient.tsx',
    'components/landing/FreeTrialCommandFlow.tsx',
    'components/modals/FirstSuccessModal.tsx',
    'components/scraper/TrialLimitModal.tsx',
    'app/dashboard/settings/page.tsx',
    'app/dashboard/billing/page.tsx',
    'app/plans/page.tsx',
  ]
  for (const f of customerFiles) {
    const src = read(f)
    assert.doesNotMatch(src, /SendLeadsModal|\/api\/results-email|\/api\/send-email|Email CSV|Send to my email|Email Me My Leads|Email my leads|outreach template/i, f)
  }
})

test('CSV export is available without email on Discover, the trial flow and the leads list', () => {
  assert.match(read('app/dashboard/scraper/page.tsx'), /Export CSV/)
  assert.match(read('app/dashboard/scraper/page.tsx'), /onExportCsv=\{\(\) => \{\s*setShowFirstSuccessModal\(false\)\s*downloadPreviewLeads\(\)/)
  assert.match(read('components/landing/FreeTrialCommandFlow.tsx'), /downloadLeadCsv\(allLeads\)/)
  assert.match(read('app/dashboard/leads/LeadsPageClient.tsx'), /Download CSV/)
})

test('copying lead contact details remains available in My Leads', () => {
  assert.match(read('app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx'), /aria-label="Copy email"/)
})

test('results-email is administrator-only (no anonymous or customer delivery)', () => {
  const route = read('app/api/results-email/route.ts')
  assert.match(route, /const denied = await adminGuard\(\)\s*if \(denied\) return denied/)
})

test('legacy sender/SMTP/template configuration is only reachable by administrators', () => {
  assert.match(read('app/dashboard/settings/page.tsx'), /if \(!isAdmin\(profile\)\) redirect\('\/dashboard\/billing'\)/)
  assert.doesNotMatch(read('app/dashboard/settings/page.tsx'), /sender_settings|smtp/i)
})

test('sidebar no longer shows the workspace information box', () => {
  assert.doesNotMatch(shell, /Paid access active across discovery/)
  assert.doesNotMatch(shell, />\s*Workspace\s*<\/div>/)
})

test('Kaia widget renders on public marketing pages only', () => {
  const kaia = read('components/kaia/kaia-widget.tsx')
  assert.match(kaia, /PUBLIC_KAIA_PATHS = \['\/', '\/plans', '\/about', '\/resources'\]/)
  assert.match(kaia, /if \(!allowed\) return null/)
  for (const path of ['/dashboard', '/admin', '/agent']) assert.ok(!kaia.includes(`'${path}'`), path)
})

test('Dashboard V3: editorial header, three statistics, de-duplicated recent searches', () => {
  const page = read('app/dashboard/page.tsx')
  for (const text of ['Your business universe.', 'Discover businesses. Understand what they do. Find your next opportunity.', 'Saved businesses', 'Research completed', 'Recent searches', 'Run again', 'Discover businesses']) {
    assert.ok(page.includes(text), text)
  }
  assert.doesNotMatch(page, /search_analytics|Command Center|Next Best Step|Usage this cycle|Good (morning|afternoon|evening)/)
  assert.match(page, /\.from\('activity_logs'\)/)
  assert.match(page, /ci_enrichment_status', 'completed'\)\s*\.not\('commercial_profile', 'is', null\)/)
  assert.match(page, /DUPLICATE_WINDOW_MS/)
  assert.match(page, /CYCLE_PLANS/)
  assert.doesNotMatch(page, /View Results/)
})

test('Dashboard V3 distinguishes loading, error, empty and populated states', () => {
  const page = read('app/dashboard/page.tsx')
  assert.match(page, /type Status = 'loading' \| 'error' \| 'ready'/)
  // the welcome screen can only be chosen once every query has succeeded
  assert.match(page, /const isEmpty =\s*status === 'ready' &&/)
  assert.match(page, /\{status === 'loading' \? <LoadingState \/> : null\}/)
  assert.match(page, /\{status === 'error' \? <ErrorState/)
  assert.match(page, /\{isEmpty \? <EmptyState \/> : null\}/)
  assert.match(page, /\{status === 'ready' && !isEmpty \? \(\s*<PopulatedState/)
  // a failed recent-searches query is an error, not an empty list
  assert.match(page, /if \(error\) throw error\s*\n\s*\n\s*return dedupeSearches/)
})

test('Dashboard V3 example searches and Run again only link to the Discover prefill', () => {
  const page = read('app/dashboard/page.tsx')
  assert.match(page, /\/dashboard\/scraper\?\$\{params\.toString\(\)\}/)
  assert.match(page, /EXAMPLE_SEARCHES = \[/)
  assert.doesNotMatch(page, /api\/scrape|runScrape|fetch\(/)
})

test('Dashboard V3 has no polling and respects reduced motion', () => {
  const page = read('app/dashboard/page.tsx')
  assert.doesNotMatch(page, /setInterval|setTimeout|refetchInterval|supabase\.channel|\.subscribe\(/)
  const css = read('app/globals.css')
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.dash-rise/)
  assert.doesNotMatch(css.replace(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\n\}\n/, ''), /animation: dash(Rise|Fade)/)
})

test('Instrument Serif is wired through the dashboard layout display slot only', () => {
  const layout = read('app/dashboard/layout.tsx')
  assert.match(layout, /Instrument_Serif/)
  assert.match(layout, /variable: '--font-display'/)
  assert.doesNotMatch(read('app/layout.tsx'), /Instrument_Serif/)
})

test('Run Again prefills Discover from the URL without starting a search', () => {
  const discover = read('app/dashboard/scraper/page.tsx')
  const a = discover.indexOf("params.get('q')")
  assert.ok(a > 0)
  const block = discover.slice(a - 200, a + 600)
  assert.match(block, /setBusinessType\(/)
  assert.match(block, /setCity\(/)
  assert.doesNotMatch(block, /runScraper|handleSubmit|startSearch|fetch\(/)
})
