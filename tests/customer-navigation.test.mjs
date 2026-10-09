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

test('customer sidebar has exactly the five approved entries, in order', () => {
  assert.deepEqual(labels(shell, 'NAV_ITEMS'), ['Dashboard', 'Discover', 'My Leads', 'Plan & Billing', 'Settings'])
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
  assert.match(page, /isAdmin\(profile\)\) return <SenderSettingsPanel \/>/)
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
  assert.match(read('app/dashboard/settings/page.tsx'), /if \(isAdmin\(profile\)\) return <SenderSettingsPanel \/>/)
  assert.doesNotMatch(read('app/dashboard/settings/page.tsx'), /sender_settings|smtp/i)
})
