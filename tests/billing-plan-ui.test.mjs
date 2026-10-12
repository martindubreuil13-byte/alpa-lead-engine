import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
function load(path, mocks) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => mocks[name] ?? require(name), module, module.exports)
  return module.exports.default
}
const Actions = load('components/billing/BillingPlanActions.tsx', {
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
})
const paid = {
  planStatus: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-11-12T00:00:00Z',
  subscriptionTier: 'starter', hasStripeSubscription: true, hasStripeCustomer: true, subscriptionActive: true,
}
const renderActions = (state) => renderToStaticMarkup(React.createElement(Actions, { initialState: state }))

test('active paying subscriber sees a visible Cancel plan button and retains confirmation', () => {
  const html = renderActions(paid)
  assert.match(html, /<button[^>]*border-white\/20[^>]*>Cancel plan<\/button>/)
  assert.doesNotMatch(html, /Resume plan|Confirm Cancellation/)
})

test('scheduled cancellation offers Resume plan instead of cancellation', () => {
  const html = renderActions({ ...paid, cancelAtPeriodEnd: true })
  assert.match(html, />Resume plan<\/button>/)
  assert.match(html, /Access until November 12, 2026/)
  assert.doesNotMatch(html, />Cancel plan<\/button>/)
})

test('unlinked admin state cannot manage a subscription', () => {
  const html = renderActions({ ...paid, subscriptionTier: 'admin', hasStripeSubscription: false, hasStripeCustomer: false })
  assert.doesNotMatch(html, /<button/)
})

async function renderPage(user) {
  const profile = { plan_status: 'active', stripe_subscription_id: user.stripe_subscription_id ?? null }
  const client = { from(table) {
    const query = {
      select() { return query }, eq() { return query }, lte() { return query }, gte() { return query },
      order() { return query }, limit() { return query }, or() { return query },
      maybeSingle() { return Promise.resolve({ data: table === 'profiles' ? profile : { leads_used: 10, leads_limit: 500, period_start: '2026-10-01', period_end: '2026-11-01' } }) },
      then(resolve) { return Promise.resolve({ count: 0 }).then(resolve) },
    }
    return query
  } }
  const Page = load('app/dashboard/billing/page.tsx', {
    'next/navigation': { redirect() { throw new Error('unexpected redirect') } },
    '@/components/billing/BillingPlanActions': { default: Actions },
    '@/components/billing/UsageCard': { default: () => null },
    '@/lib/auth/get-user-profile': { getUserProfile: async () => user },
    '@/lib/auth/access': { isAdmin: (u) => u.plan === 'admin', isFree: (u) => u.plan === 'free', isPaid: (u) => u.plan === 'starter' },
    '@/lib/usage/usage': { getLeadLimit: () => 500 },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => client },
  })
  return renderToStaticMarkup(await Page())
}

test('billing page renders paid active and scheduled-cancellation actions', async () => {
  const user = { id: 'fixture', email: 'fixture@example.com', plan: 'starter', stripe_subscription_id: 'sub_fixture', subscription_active: true }
  assert.match(await renderPage(user), />Cancel plan<\/button>/)
  assert.match(await renderPage({ ...user, cancel_at_period_end: true }), />Resume plan<\/button>/)
})

test('Admin Access page explains absence of paid management and renders no cancellation action', async () => {
  const html = await renderPage({ id: 'fixture', email: 'fixture@example.com', plan: 'admin' })
  assert.match(html, /Admin Access/)
  assert.match(html, /It is not a paid subscription/)
  assert.doesNotMatch(html, /Cancel plan|Resume plan|<button/)
})

test('Cancel plan opens confirmation before any request; confirmation and resume use existing handlers', async () => {
  const values = []
  let cursor = 0
  const requests = []
  const Interactive = load('components/billing/BillingPlanActions.tsx', {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    react: {
      ...React,
      useState(initial) {
        const index = cursor++
        if (!(index in values)) values[index] = initial
        return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
      },
      useRef: () => ({ current: false }), useTransition: () => [false, (fn) => fn()],
    },
  })
  function buttons(node, result = []) {
    if (!node || typeof node !== 'object') return result
    if (node.type === 'button') result.push(node)
    for (const child of [node.props?.children].flat(Infinity)) buttons(child, result)
    return result
  }
  const render = () => { cursor = 0; return Interactive({ initialState: paid }) }
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => ({ cancel_at_period_end: url.endsWith('/cancel') }) }
  }
  try {
    buttons(render())[0].props.onClick()
    assert.equal(requests.length, 0)
    let controls = buttons(render())
    assert.deepEqual(controls.map((b) => b.props.children), ['Cancel plan', 'Keep Plan', 'Cancel plan'])
    controls[1].props.onClick()
    assert.equal(requests.length, 0)
    assert.equal(buttons(render()).length, 1)
    buttons(render())[0].props.onClick()
    buttons(render()).at(-1).props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(requests[0].url, '/api/billing/cancel')
    assert.equal(requests[0].options.method, 'POST')
    controls = buttons(render())
    assert.equal(controls[0].props.children, 'Resume plan')
    controls[0].props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(requests[1].url, '/api/billing/resume')
    assert.equal(requests[1].options.method, 'POST')
  } finally {
    globalThis.fetch = previousFetch
  }
})
