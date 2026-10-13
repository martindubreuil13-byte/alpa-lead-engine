import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { countOptions, describeAllowance } from '../lib/guest/snapshot.ts'

const read = (file) => fs.readFileSync(file, 'utf8')

test('what a visitor can still do comes from the server record: 25 businesses and 3 searches in total', () => {
  assert.deepEqual(describeAllowance(null), { used: 0, attempts: 0, saved: 0, remaining: 25, exhausted: false })
  const some = describeAllowance({ used: 10, attempts: 1, leads: new Array(10).fill({}) })
  assert.deepEqual(some, { used: 10, attempts: 1, saved: 10, remaining: 15, exhausted: false })
  assert.equal(describeAllowance({ used: 25, attempts: 2, leads: [] }).exhausted, true)
  assert.equal(describeAllowance({ used: 9, attempts: 3, leads: [] }).exhausted, true, 'three searches is the limit even with businesses left')
})

test('the count choices never offer more than what is left', () => {
  assert.deepEqual(countOptions(25), ['10', '25'])
  assert.deepEqual(countOptions(15), ['10', '15'])
  assert.deepEqual(countOptions(10), ['10'])
  assert.deepEqual(countOptions(7), ['7'])
  assert.deepEqual(countOptions(0), ['1'])
})

test('/trial is a real route that replaces the modal; the landing call to action is a link to it', () => {
  assert.ok(fs.existsSync('app/trial/page.tsx'))
  assert.match(read('app/trial/layout.tsx'), /index: false/)
  assert.match(read('app/trial/page.tsx'), /TrialExperience/)
  const cta = read('components/landing/FreshStartCta.tsx')
  assert.match(cta, /<Link href="\/trial"/)
  assert.doesNotMatch(cta, /<button|dispatchEvent|preventDefault/)
  assert.equal(fs.existsSync('components/landing/FreeTrialCommandFlow.tsx'), false, 'the old modal is retired')
  assert.doesNotMatch(read('app/page.tsx'), /FreeTrialCommandFlow/)
})

test('no component or page still depends on the retired modal or its open event', () => {
  const stack = ['app', 'components', 'lib']
  const files = []
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = `${dir}/${e.name}`; if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(f)) files.push(f) } }
  stack.forEach(walk)
  for (const f of files) assert.doesNotMatch(read(f), /FreeTrialCommandFlow|alpa:open-trial-flow|open-request/, f)
})

test('the trial page reuses the application\'s own search form and progress engine, with real engine events', () => {
  const page = read('components/trial/TrialExperience.tsx')
  assert.match(page, /from '@\/components\/scraper\/DiscoverSearchForm'/)
  assert.match(page, /from '@\/components\/scraper\/DiscoverEngine'/)
  assert.match(page, /buildEngineView\(/)
  const hook = read('components/trial/useTrialSearch.ts')
  assert.match(hook, /applyDiscoveryLog/)
  assert.match(hook, /applyProgressEvent/)
  assert.match(hook, /confirmDiscoveryResult/)
  assert.doesNotMatch(hook + page, /STEPS\b|setTimeout\([^)]*stepsRevealed|STEP_DELAYS/, 'no simulated steps')
})

test('the trial route has no modal, no email field and no sales pop-up', () => {
  for (const file of ['components/trial/TrialExperience.tsx', 'components/trial/TrialPanels.tsx', 'app/trial/page.tsx', 'app/trial/layout.tsx']) {
    const src = read(file)
    assert.doesNotMatch(src, /role="dialog"|aria-modal|type="email"|type="password"|50%|discount|% off/i, file)
  }
})

test('a returning visitor is recognised and the way forward is clear', () => {
  const panels = read('components/trial/TrialPanels.tsx')
  assert.match(panels, /Welcome back\./)
  assert.match(panels, /You have \{saved\} \{saved === 1 \? 'business' : 'businesses'\} saved from your previous \{searches > 1 \? 'searches' : 'search'\}\./)
  assert.match(panels, /View my businesses →/)
  assert.match(panels, /Find more businesses →/)
  const page = read('components/trial/TrialExperience.tsx')
  // order: a running search first, then the used-up state, then welcome back, then the form
  assert.ok(page.indexOf("search.status === 'running'") < page.indexOf('allowance.exhausted'))
  assert.ok(page.indexOf('allowance.exhausted') < page.indexOf('<WelcomeBack'))
  assert.ok(page.indexOf('<WelcomeBack') < page.indexOf('<DiscoverSearchForm'))
})

test('a visitor with no free businesses left gets a calm state with the way forward, not a form that ends in an error', () => {
  const panels = read('components/trial/TrialPanels.tsx')
  const used = panels.slice(panels.indexOf('export function AllowanceUsed'), panels.indexOf('export function SearchFailed'))
  assert.match(used, /You&apos;ve used your free businesses\./)
  assert.match(used, /href="\/trial\/results"/)
  assert.match(used, /href="\/plans"/)
  assert.doesNotMatch(used, /<form|<input/)
})

test('results stay reachable and lead back into the trial', () => {
  const results = read('components/guest/GuestWorkspace.tsx')
  assert.doesNotMatch(results, /<main|min-h-screen/, 'the page shell comes from the trial layout')
  assert.match(results, /href="\/trial"/)
  assert.match(results, /Your businesses are ready\./)
})
