import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildConversionCopy, describeOfferEligibility, FIRST_MONTH_OFFER } from '../lib/billing/first-month-offer.ts'
import { describeClaimNotice } from '../lib/guest/claim-notice.ts'
import { countOptions, describeAllowance } from '../lib/guest/snapshot.ts'

const read = (file) => fs.readFileSync(file, 'utf8')

// ---- what may be said

test('the upgrade moment says exactly what was agreed, and the offer is previewed, not promised', () => {
  const c = buildConversionCopy({ kind: 'allowance', saved: 25, eligible: true })
  assert.equal(c.headline, "You've discovered your 25 free businesses.")
  assert.equal(c.support, 'Ready to find more?')
  assert.equal(c.offerLine, 'Enjoy 50% off your first month of ALPA when you upgrade.')
  assert.equal(c.terms, 'The discount applies to your first month only. Regular pricing resumes afterward.')
  assert.equal(c.primaryCta, 'Explore ALPA plans →')
  assert.equal(c.secondaryCta, 'View my businesses →')
  assert.match(c.offerBadge, /not active yet/)
  assert.match(c.inactiveNotice, /not active yet, so nothing is discounted today/)
  assert.equal(c.activeNotice, null)
})

test('the production discount stays preview-only; isolated test checkout may inspect eligibility', () => {
  assert.equal(FIRST_MONTH_OFFER.status, 'preview')
  assert.deepEqual([FIRST_MONTH_OFFER.percentOff, FIRST_MONTH_OFFER.durationMonths], [50, 1])
  // if it were active the notice would flip; proves the preview wording is not hard-coded into the screen
  const live = buildConversionCopy({ kind: 'allowance', saved: 25, eligible: true, offer: { ...FIRST_MONTH_OFFER, status: 'active' } })
  assert.equal(live.inactiveNotice, null); assert.match(live.activeNotice, /applied at checkout/)
  for (const file of ['lib/stripe.ts', 'lib/stripe/subscription.ts', 'lib/stripe/checkout-guard.ts', 'app/api/checkout/route.ts', 'app/api/stripe/webhook/route.ts', 'app/plans/page.tsx', 'components/checkout/StartCheckoutButton.tsx', 'lib/usage/usage.ts']) {
    if (file === 'app/api/checkout/route.ts') {
      assert.match(read(file), /introEligible: describeOfferEligibility\(profile\)\.eligible/)
    } else if (fs.existsSync(file)) assert.doesNotMatch(read(file), /first-month-offer|FIRST_MONTH_OFFER/, `${file} cannot activate the production display offer`)
  }
})

test('used the free searches before reaching 25 businesses: truthful headline, same offer', () => {
  const c = buildConversionCopy({ kind: 'searches', saved: 12, eligible: true })
  assert.equal(c.headline, "You've used your three free searches.")
  assert.equal(c.support, 'You discovered 12 businesses across them, before reaching your 25. Ready to find more?')
  assert.doesNotMatch(c.headline + c.support, /first 25/)
  assert.equal(buildConversionCopy({ kind: 'searches', saved: 1, eligible: true }).support, 'You discovered 1 business across them, before reaching your 25. Ready to find more?')
})

test('someone the offer is not for sees the same page with no discount at all', () => {
  const c = buildConversionCopy({ kind: 'allowance', saved: 25, eligible: false })
  assert.deepEqual([c.offerLine, c.offerBadge, c.terms, c.inactiveNotice, c.activeNotice], [null, null, null, null, null])
  assert.equal(c.headline, "You've discovered your 25 free businesses.")
})

// ---- who it is for

test('eligibility: guests and brand-new free members; never paid subscribers, administrators or returning ex-subscribers', () => {
  assert.deepEqual(describeOfferEligibility(null), { eligible: true, reason: 'guest' })
  assert.deepEqual(describeOfferEligibility({ plan: 'free', plan_status: null }), { eligible: true, reason: 'new_free_member' })
  assert.deepEqual(describeOfferEligibility({ plan: 'free', plan_status: 'free' }), { eligible: true, reason: 'new_free_member' })
  assert.equal(describeOfferEligibility({ plan: 'free', stripe_subscription_id: null }).eligible, true, 'a customer record alone is not a subscription')
  for (const paid of [{ plan: 'starter', plan_status: 'active' }, { plan: 'prospector', plan_status: 'canceling' }, { plan: 'starter', plan_status: 'trialing' }, { plan: 'free', plan_status: 'active' }, { plan: 'pro' }, { plan: 'free', subscription_active: true }]) {
    assert.deepEqual(describeOfferEligibility(paid), { eligible: false, reason: 'paid' }, JSON.stringify(paid))
  }
  assert.deepEqual(describeOfferEligibility({ plan: 'admin' }), { eligible: false, reason: 'administrator' })
  assert.deepEqual(describeOfferEligibility({ plan: 'free', role: 'admin' }), { eligible: false, reason: 'administrator' })
  for (const former of [{ plan: 'free', plan_status: 'canceled', stripe_subscription_id: 'sub_1' }, { plan: 'free', canceled_at: '2026-06-01T00:00:00Z' }, { plan: 'free', plan_status: 'past_due' }, { plan: 'free', stripe_subscription_id: 'sub_old' }]) {
    assert.deepEqual(describeOfferEligibility(former), { eligible: false, reason: 'previous_subscriber' }, JSON.stringify(former))
  }
})

test('returning guests: the upgrade moment follows the server record of 0, 10, 24 and 25 businesses, and of the 3 searches', () => {
  const leads = (n) => new Array(n).fill({})
  const state = (used, attempts, saved = used) => describeAllowance({ used, attempts, leads: leads(saved) })
  assert.equal(state(0, 0).exhausted, false)
  assert.equal(state(10, 1).exhausted, false); assert.equal(state(10, 1).remaining, 15)
  assert.equal(state(24, 2).exhausted, false); assert.equal(state(24, 2).remaining, 1); assert.deepEqual(countOptions(1), ['1'])
  assert.equal(state(25, 2).exhausted, true)
  assert.equal(state(12, 3).exhausted, true, 'three searches is the limit even with businesses left')
  const exhaustedKind = (used, attempts) => (used >= 25 ? 'allowance' : 'searches')
  assert.equal(exhaustedKind(25, 2), 'allowance'); assert.equal(exhaustedKind(12, 3), 'searches')
})

// ---- the screens

test('the upgrade panel is calm: no pop-up, no countdown, no urgency, no email, no billing code', () => {
  const panel = read('components/conversion/UpgradePanel.tsx').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(panel, /role="dialog"|aria-modal|setInterval|setTimeout|Date\.now|countdown|limited time|only today|last chance|hurry|expires|seconds left|hours left|type="email"/i)
  assert.doesNotMatch(panel, /stripe|checkout|fetch\(|coupon|promotion/i)
  assert.match(panel, /plansHref = '\/plans'/); assert.match(panel, /href=\{secondaryHref\}/)
  assert.match(panel, /copy\.inactiveNotice/); assert.match(panel, /copy\.terms/)
  assert.match(panel, /conversion_offer_viewed/); assert.match(panel, /conversion_cta_clicked/)
  assert.doesNotMatch(panel, /email:|user_id|session_id/, 'analytics carry no personal data')
})

test('guests: /trial shows the upgrade moment from the server record or a refused search, and a busy network stays a plain message', () => {
  const page = read('components/trial/TrialExperience.tsx')
  assert.match(page, /search\.failure\?\.kind === 'limit'/)
  assert.match(page, /allowance\.exhausted \|\| limitSeen/)
  assert.match(page, /audience="guest"/); assert.match(page, /describeOfferEligibility\(null\)/)
  assert.match(page, /secondaryHref=\{RESULTS_HREF\}/)
  const errors = read('lib/guest/search-errors.ts')
  assert.match(errors, /GUEST_RATE_LIMITED: 'rate'/); assert.doesNotMatch(errors.slice(errors.indexOf('KIND_BY_CODE')), /GUEST_RATE_LIMITED: 'limit'/)
})

test('free members: the same panel replaces the search form, not a pop-up; paid subscribers are never touched', () => {
  const page = read('app/dashboard/scraper/page.tsx')
  assert.match(page, /const showUpgradeMoment = !privatePreview && !isPlanLoading && isFree && usageBlocked/)
  assert.match(page, /describeOfferEligibility\(isGuest \? null : profile\)/)
  assert.match(page, /audience=\{isGuest \? 'guest' : 'free_member'\}/)
  assert.match(page, /secondaryHref=\{isGuest \? '\/trial\/results' : '\/dashboard\/my-leads'\}/)
  assert.ok(page.indexOf('showUpgradeMoment ? (') < page.indexOf('<DiscoverSearchForm'))
  assert.match(page, /const isFree = isGuest \|\| plan === 'free'/, 'paid plans are not free, so they never reach the panel')
  assert.doesNotMatch(page, /TrialLimitModal|setShowTrialLimitModal/)
  assert.equal(fs.existsSync('components/scraper/TrialLimitModal.tsx'), false)
})

// ---- account import: never silent

test('the import notice says how many were saved and, when a free account had no room, how many were not and where they are', () => {
  const n = describeClaimNotice({ imported: 15, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 10 })
  assert.equal(n.tone, 'attention'); assert.equal(n.title, 'We saved 15 of your 25 free-trial businesses to My Leads.')
  assert.match(n.body, /10 were not added/); assert.match(n.body, /still on your free trial page until that expires/)
  assert.equal(n.showTrialLink, true); assert.equal(n.showPlansLink, true)
  assert.equal(describeClaimNotice({ imported: 0, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 25 }).title, 'None of your free-trial businesses could be added to My Leads.')
  assert.match(describeClaimNotice({ imported: 24, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 1 }).body, /1 was not added\. It is still on/)
  assert.equal(describeClaimNotice({ imported: 3, skipped_invalid: 0, skipped_duplicate: 2, skipped_allowance: 5 }).title, 'We saved 5 of your 10 free-trial businesses to My Leads.', 'ones already in My Leads count as saved')
  // never claims everything was saved when something was left out
  for (const left of [1, 5, 25]) assert.doesNotMatch(describeClaimNotice({ imported: 5, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: left }).title, /^\d+ of your free-trial businesses? (is|are) saved/)
  const all = describeClaimNotice({ imported: 25, skipped_invalid: 0, skipped_duplicate: 0 })
  assert.equal(all.tone, 'info'); assert.equal(all.title, '25 of your free-trial businesses are saved in My Leads.'); assert.equal(all.showPlansLink, false)
  assert.equal(describeClaimNotice(null), null); assert.equal(describeClaimNotice({ imported: 0, skipped_invalid: 0, skipped_duplicate: 0 }), null)
})

test('the notice is shown where a new member lands, can be dismissed, and survives blocked storage', () => {
  assert.match(read('app/dashboard/scraper/page.tsx'), /<ClaimNotice \/>/)
  assert.match(read('components/my-leads/MyLeadsWorkspace.tsx'), /<ClaimNotice \/>/)
  const notice = read('components/guest/ClaimNotice.tsx')
  assert.match(notice, /clearStoredGuestClaimResult\(\)/); assert.match(notice, /aria-label="Dismiss"/)
  const store = read('lib/session/scrape-result.ts')
  assert.match(store, /safeGetItem\('session', GUEST_CLAIM_RESULT_STORAGE_KEY\)/)
  assert.match(store, /skipped_allowance/)
  assert.match(read('lib/guest/claim-client.ts'), /skipped_allowance: data\.skipped_allowance/)
})

test('the offer is documented with what activation needs, and the documented steps cover Stripe, server enforcement and BIL2', () => {
  const doc = read('docs/free-to-paid-offer.md')
  for (const needle of ['not active', 'first_time_transaction', 'duration: once', 'server', 'BIL2', 'test-mode purchase', "FIRST_MONTH_OFFER.status", 'one redemption per customer']) assert.match(doc, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), needle)
})
