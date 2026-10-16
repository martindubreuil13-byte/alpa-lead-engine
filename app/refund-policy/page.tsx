import Link from 'next/link'

import LegalDocument, { LegalSection, OwnerDecision, legalMetadata } from '@/components/legal/LegalDocument'

export const metadata = legalMetadata(
  'Refund and Cancellation Policy',
  'How subscriptions renew, how to cancel ALPA, and how refunds are handled.',
  '/refund-policy'
)

const contents = [
  { id: 'billing', title: 'How billing works' },
  { id: 'cancel', title: 'Cancelling' },
  { id: 'refunds', title: 'Refunds' },
  { id: 'quota', title: 'Used and unused businesses' },
  { id: 'failed', title: 'Failed payments' },
  { id: 'changes', title: 'Changing plan' },
  { id: 'free', title: 'The free plan' },
  { id: 'how', title: 'How to ask' },
]

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      activePath="/refund-policy"
      title="Refund and Cancellation Policy"
      intro="This page explains how ALPA subscriptions are billed and cancelled. The cancellation process described here is how the product works today. The refund terms are open for the owner to decide."
      contents={contents}
    >
      <LegalSection id="billing" title="How billing works">
        <p>
          ALPA Starter and ALPA Pro are monthly subscriptions. You pay for each month in advance on a Stripe-hosted checkout page, and the
          subscription continues month to month until you cancel. Current prices are on the{' '}
          <Link href="/plans" className="text-cyan-200 underline underline-offset-4">Plans</Link> page.
        </p>
        <OwnerDecision id="R1">
          Confirm the currency, whether taxes are added to the listed price, and the wording of the automatic-renewal notice required where
          you sell. Also decide whether and how any introductory offer (such as a discounted first month) is described; none is active today.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="cancel" title="Cancelling">
        <p>
          You can cancel at any time from your billing page, without contacting us. Cancelling stops future renewals. Your cancellation takes
          effect at the end of the billing period you have already paid for, and your account keeps its plan until then. Until the end of
          that period you can change your mind and resume the subscription from the same page.
        </p>
        <p>After the subscription ends the account moves to the free plan. Your saved businesses stay available subject to the free allowance and the retention rules in the <Link href="/privacy" className="text-cyan-200 underline underline-offset-4">Privacy Policy</Link>.</p>
        <OwnerDecision id="R2">
          Decide what happens to saved businesses and exports after a subscription ends: whether they stay accessible in full, become
          read-only, or are removed after a set time.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="refunds" title="Refunds">
        <OwnerDecision id="R3">
          The refund commitment is a business decision and nothing is promised on this page yet. Choose one and write it in plain words:
          <span className="mt-2 block">
            (a) No refunds for a period already started, because cancellation takes effect at the end of the period; or
            (b) A full refund of the latest payment if requested within a number of days and the quota has not been used (or only a
            limited part); or
            (c) A fixed-period money-back guarantee on the first payment.
          </span>
          <span className="mt-2 block">
            Also decide: who can approve exceptions, how the refund is sent (to the original card through Stripe), the time it takes, and
            what statutory refund or withdrawal rights apply in the places you sell to. Consumer law may give rights that this policy
            cannot remove, so take legal advice before publishing.
          </span>
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="quota" title="Used and unused businesses">
        <p>
          Each paid plan includes a number of businesses per month. Allowances renew on the usage date shown in your account. Unused
          businesses do not roll over, and businesses already delivered are not returned to the allowance if you later cancel.
        </p>
        <OwnerDecision id="R4">
          Decide whether a refund is reduced or denied once businesses have been delivered, and whether a failed or empty search that did not
          deliver businesses is credited. State it here so refund and quota rules do not conflict.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="failed" title="Failed payments">
        <p>
          If a renewal payment fails, Stripe may retry it. While the payment is unresolved ALPA may limit paid features. If it cannot be
          collected, the subscription ends and the account returns to the free plan.
        </p>
        <OwnerDecision id="R5">
          Confirm the retry schedule and the grace period you want, since they are set in Stripe, not in this page, and must match the text.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="changes" title="Changing plan">
        <OwnerDecision id="R6">
          Changing between Starter and Pro from the billing page is switched off in the current build. Decide whether to enable it and how
          price differences are handled (immediately with proration, or at the next renewal) before describing it here.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="free" title="The free plan">
        <p>The free plan costs nothing and has nothing to refund or cancel. It includes 25 businesses in total, one time.</p>
      </LegalSection>

      <LegalSection id="how" title="How to ask">
        <OwnerDecision id="R7">
          Give the address that handles billing questions and refund requests, and the time you commit to for replying. None is invented.
        </OwnerDecision>
      </LegalSection>
    </LegalDocument>
  )
}
