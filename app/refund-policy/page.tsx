import Link from 'next/link'

import LegalDocument, { LegalSection, legalMetadata } from '@/components/legal/LegalDocument'
import { LEGAL_ENTITY } from '@/lib/legal'

export const metadata = legalMetadata(
  'Refund and Cancellation Policy',
  'How ALPA subscriptions renew, how to cancel, and how refunds are handled.',
  '/refund-policy'
)

const contents = [
  { id: 'billing', title: 'How billing works' },
  { id: 'cancel', title: 'Cancelling' },
  { id: 'refunds', title: 'Refunds' },
  { id: 'consumers', title: 'Your statutory rights' },
  { id: 'quota', title: 'Used and unused businesses' },
  { id: 'failed', title: 'Failed payments' },
  { id: 'free', title: 'The free plan' },
  { id: 'how', title: 'How to contact us' },
]

const link = 'text-cyan-200 underline underline-offset-4'

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      activePath="/refund-policy"
      title="Refund and Cancellation Policy"
      intro="This page explains how ALPA subscriptions are billed, how you cancel, and when a refund is available."
      contents={contents}
    >
      <LegalSection id="billing" title="How billing works">
        <p>
          ALPA Starter ($9.99) and ALPA Pro ($24.99) are monthly subscriptions. You pay for each month in advance on a Stripe-hosted checkout page, in US dollars,
          and the subscription renews every month until you cancel it. Current prices are on the <Link href="/plans" className={link}>Plans</Link> page. If tax
          applies to your purchase, it is shown at checkout before you pay.
        </p>
      </LegalSection>

      <LegalSection id="cancel" title="Cancelling">
        <p>
          You can cancel at any time from your billing page, without contacting us. Cancelling stops future renewals. Paid access continues until the end of the
          billing period you have already paid for. Until then you can change your mind and resume the subscription from the same page.
        </p>
        <p>
          When the subscription ends, the account moves to the free plan. Your account and saved businesses stay, as described in the{' '}
          <Link href="/privacy" className={link}>Privacy Policy</Link>. You can subscribe again at any time.
        </p>
      </LegalSection>

      <LegalSection id="refunds" title="Refunds">
        <p>
          Payments are generally non-refundable. We refund a payment where applicable law requires it, or where MINDRA expressly approves a refund for you.
          Because cancelling takes effect at the end of the period you have paid for, you keep access for the time you paid for and no partial refund is
          due for the unused part of a period.
        </p>
        <p>
          To ask for a refund, email <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className={link}>{LEGAL_ENTITY.contactEmail}</a> from the address of your
          account, with the date and amount of the payment. An approved refund is returned to the card or payment method used, through Stripe; how long your
          bank takes to show it is outside our control.
        </p>
      </LegalSection>

      <LegalSection id="consumers" title="Your statutory rights">
        <p>
          This policy does not remove or limit any right you have by law, and we do not ask you to waive one. If you are a consumer, applicable law, such as
          EU consumer law, may give you a right to withdraw from a distance contract within a set period, or other rights to a remedy. Where such a right
          applies and you use it, we will handle your request as the law requires. Where the law allows it, a refund can be reduced by a proportionate amount
          for the service already provided. Contact us at the address below to use a statutory right.
        </p>
      </LegalSection>

      <LegalSection id="quota" title="Used and unused businesses">
        <p>
          Each paid plan includes a number of businesses per month. Allowances renew on the usage date shown in your account. Unused businesses do not roll over,
          and businesses already delivered to you are not returned to the allowance if you later cancel.
        </p>
      </LegalSection>

      <LegalSection id="failed" title="Failed payments">
        <p>
          If a renewal payment fails, our payment provider may retry it. While the payment is unresolved ALPA may limit paid features. If it cannot be collected,
          the subscription ends and the account returns to the free plan.
        </p>
      </LegalSection>

      <LegalSection id="free" title="The free plan">
        <p>The free plan costs nothing and has nothing to refund or cancel. It includes 25 businesses, lifetime.</p>
      </LegalSection>

      <LegalSection id="how" title="How to contact us">
        <p>
          Billing questions, refund requests and cancellation problems: <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className={link}>{LEGAL_ENTITY.contactEmail}</a>.
          {' '}{LEGAL_ENTITY.name}, {LEGAL_ENTITY.address}.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
