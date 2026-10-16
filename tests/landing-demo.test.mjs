// The landing-page demonstration: what it may and may not claim, what it loads, how it behaves for people who ask for less motion, and
// that the page around it is untouched. Static checks over the source; the browser behaviour is in landing-demo-browser.mjs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'

import { DEMO_BUSINESSES, DEMO_FEATURED, DEMO_SEARCH, DEMO_STAGES, DEMO_TEXT_ALTERNATIVE, demoMapDots } from '../components/landing/alpa-demo-data.ts'

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const page = read('app/page.tsx')
const component = read('components/landing/AlpaDemo.tsx')
const css = read('components/landing/AlpaDemo.module.css')
const data = read('components/landing/alpa-demo-data.ts')

test('sample data: every business is fictional (reserved phone range, reserved domain) and says so on screen', () => {
  assert.equal(DEMO_BUSINESSES.length, 7)
  for (const b of DEMO_BUSINESSES) {
    assert.match(b.phone, /^\((416|647)\) 555-01\d\d$/, `${b.name}: a phone number in the reserved 555-01xx range`)
    assert.match(b.website, /\.example$/, `${b.name}: a reserved .example website`)
    if (b.email) assert.match(b.email, /@[a-z]+\.example$/, `${b.name}: a reserved .example email`)
  }
  assert.ok(DEMO_BUSINESSES.some((b) => b.email === null), 'at least one business has no public email, and the demonstration shows that')
  assert.ok(DEMO_FEATURED.email, 'the featured business shows what it looks like when an email is published')
  assert.deepEqual([DEMO_SEARCH.industry, DEMO_SEARCH.location, DEMO_SEARCH.count], ['Architects', 'Toronto', 25])
  assert.match(component, /Demonstration · sample data/); assert.match(component, /Sample businesses are fictional/)
  assert.match(component, /contact details appear only when a business publishes them/)
})

test('claims: nothing guarantees contact details or information, and the AI profile is attributed to what the business publishes', () => {
  const visible = (component + data).replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(visible, /guarantee|always find|every business|100%|verified|accurate|complete/i)
  assert.match(visible, /Written from the information the business publishes\. Details vary\./)
  assert.match(visible, /Not publicly listed/)
  assert.match(DEMO_TEXT_ALTERNATIVE, /sample, fictional businesses/); assert.match(DEMO_TEXT_ALTERNATIVE, /when the business publishes one/)
  assert.deepEqual(DEMO_STAGES.map((s) => s.label), ['Discover', 'Enrich', 'AI Intelligence'])
})

test('it loads nothing and calls nothing: no network, no library, no paid AI, no storage, no tracking', () => {
  assert.doesNotMatch(component + data, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|import\(|localStorage|sessionStorage|document\.cookie|trackEvent|openai|supabase|stripe/i)
  const imports = [...component.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual(imports.filter((name) => !name.startsWith('@/') && name !== 'react'), ['lucide-react'], 'the only library is the icon set the site already uses (four icons, tree-shaken)')
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:|@font-face/)
  assert.doesNotMatch(component, /framer-motion|gsap|lottie|motion-one|react-spring/, 'no animation library is used')
  assert.equal(read('package.json'), execFileSync('git', ['show', '8854d35:package.json'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }), 'no dependency was added or changed')
})

test('motion: only for people who have not asked for less; compositor-friendly properties; pausable; plays only on screen', () => {
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  const start = css.indexOf('/* ── motion')
  const outside = css.slice(0, start)
  assert.ok(start > 0)
  assert.doesNotMatch(outside.replace(/transition: [^;]+;/g, ''), /animation\s*:/, 'no animation is defined outside the no-preference block')
  const motion = css.slice(start, css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(motion, /\.sweep \{ animation/); assert.match(motion, /animation-play-state: paused/)
  const frames = css.slice(css.indexOf('@keyframes sweep'))
  const names = [...frames.matchAll(/@keyframes (\w+)/g)].map((m) => m[1])
  assert.ok(names.length >= 12, `${names.length} keyframes`)
  const properties = new Set([...frames.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map((m) => m[1]))
  for (const property of properties) assert.ok(['opacity', 'transform', 'clip-path'].includes(property), `animating ${property} would not be compositor-friendly`)
  assert.doesNotMatch(css, /filter:\s*blur|backdrop-filter/, 'no blur: it is expensive on phones')
  assert.match(component, /IntersectionObserver/); assert.match(component, /visibilitychange/); assert.match(component, /prefers-reduced-motion: reduce/)
  assert.match(component, /aria-label=\{paused \? 'Play the demonstration' : 'Pause the demonstration'\}/, 'a pause control, as an auto-playing region needs')
  assert.match(component, /hidden=\{reduced\}/)
})

test('accessibility: the animation is decorative, a text alternative describes it, steps are real buttons, focus is visible', () => {
  assert.match(component, /role="group"/); assert.match(component, /aria-label="ALPA workflow demonstration with sample data"/)
  assert.match(component, /DEMO_TEXT_ALTERNATIVE/)
  assert.ok((component.match(/aria-hidden="true"/g) ?? []).length >= 6)
  assert.match(component, /aria-pressed=\{index === stage\}/)
  assert.match(css, /focus-visible/)
  assert.match(css, /\.control \{[^}]*width: 44px;[^}]*height: 44px/s, 'the pause button is a 44px target')
  assert.match(css, /\.railButton \{[^}]*min-height: 52px/s)
})

test('layout: a fixed body height so the animation never shifts the page, and a one-thing-at-a-time layout for narrow screens', () => {
  assert.match(css, /\.body \{[^}]*min-height: 318px/s)
  assert.match(css, /@container \(max-width: 539px\)/); assert.match(css, /\.root:not\(\[data-stage='discover'\]\) \.list \{ display: none; \}/)
  assert.match(css, /container-type: inline-size/)
})

test('map dots: deterministic, so the server and the browser draw the same picture, spaced apart and inside the frame', () => {
  const a = demoMapDots(25); const b = demoMapDots(25)
  assert.deepEqual(a, b); assert.equal(a.length, 25)
  for (const d of a) assert.ok(d.x >= 28 && d.x <= 372 && d.y >= 26 && d.y <= 216)
  for (let i = 0; i < a.length; i += 1) for (let j = i + 1; j < a.length; j += 1) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) > 30)
})

test('the page around it is unchanged: hero message, primary call to action, pricing and sign-up links, metadata and structured data', () => {
  assert.match(page, /You need customers\.<br \/><span className="text-\[#d9bd82\]">We find them for you\.<\/span>/)
  assert.match(page, /<FreshStartCta className=\{cta\}>Find 25 businesses free →<\/FreshStartCta>/)
  assert.match(page, /No account\. No credit card\. Just start\./)
  assert.match(page, /<PublicHeader trialCta \/>/); assert.match(page, /href="\/plans"/); assert.match(page, /View Plans/)
  assert.match(page, /Lead Generation Tool for Freelancers & Agencies \| ALPA/); assert.match(page, /canonical: '\/'/)
  assert.match(page, /'@type': 'SoftwareApplication'/); assert.match(page, /priceCurrency: 'USD'/); assert.match(page, /LandingPageTracker/)
  assert.match(page, /<AlpaDemo \/>/)
  assert.equal((page.match(/<FreshStartCta/g) ?? []).length, 5, 'every call to action is still there')
  const base = execFileSync('git', ['show', '8854d35:app/page.tsx'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname })
  for (const text of ['Find 25 businesses free →', 'See what ALPA can find →', 'Try it free →', 'Start free', 'Start discovering →']) assert.ok(base.includes(text) && page.includes(text), text)
  assert.match(read('components/landing/FreshStartCta.tsx'), /href="\/trial"/)
})
