import Link from 'next/link'

import LegalDocument, { LegalSection, legalMetadata } from '@/components/legal/LegalDocument'
import { LEGAL_ENTITY } from '@/lib/legal'

export const metadata = legalMetadata(
  'Terms of Service',
  'The terms that apply when you use ALPA by MINDRA to discover businesses, research them and export lists.',
  '/terms'
)

const contents = [
  { id: 'who', title: 'Who provides ALPA' },
  { id: 'service', title: 'What ALPA does' },
  { id: 'accounts', title: 'Accounts and the free trial' },
  { id: 'plans', title: 'Plans, usage and quotas' },
  { id: 'payment', title: 'Payment, cancellation and refunds' },
  { id: 'data', title: 'Business information and third-party data' },
  { id: 'ai', title: 'AI-generated information' },
  { id: 'use', title: 'Acceptable use and your responsibilities' },
  { id: 'outreach', title: 'Contacting businesses' },
  { id: 'availability', title: 'Availability and changes' },
  { id: 'liability', title: 'Warranty and liability' },
  { id: 'law', title: 'Governing law' },
  { id: 'contact', title: 'Contact' },
]

const link = 'text-cyan-200 underline underline-offset-4'

export default function TermsPage() {
  return (
    <LegalDocument
      activePath="/terms"
      title="Terms of Service"
      intro="These terms apply when you use ALPA, a service that helps you find businesses, review the contact information and research available about them, and export your lists."
      contents={contents}
    >
      <LegalSection id="who" title="Who provides ALPA">
        <p>
          ALPA is provided by {LEGAL_ENTITY.name} (registry code {LEGAL_ENTITY.registryCode}, registration number {LEGAL_ENTITY.registrationNumber}),
          whose registered office is at {LEGAL_ENTITY.address}. In these terms, “ALPA”, “MINDRA”, “we” and “us” mean that company. By using ALPA you
          agree to these terms, to the <Link href="/privacy" className={link}>Privacy Policy</Link> and to the{' '}
          <Link href="/refund-policy" className={link}>Refund and Cancellation Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="service" title="What ALPA does">
        <p>
          You describe the kind of business and the place you are interested in. ALPA searches business listings from third-party providers,
          visits public business websites to look for contact details such as an email address or phone number, and can prepare a short written
          summary of what a business appears to do. You can save the results to your account and export them as a CSV file.
        </p>
        <p>ALPA does not send messages on your behalf, and it does not guarantee that any business will respond or become a customer.</p>
      </LegalSection>

      <LegalSection id="accounts" title="Accounts and the free trial">
        <p>
          You can try ALPA without an account and see up to 25 businesses. Your trial results are kept in your browser and on our servers so that they
          survive a reload, and when you create an account we offer to move them into it.
        </p>
        <p>
          To keep results, use a paid plan or return later, you need an account. You must give an email address you control, keep your password
          confidential, and tell us if you think someone else has accessed your account. You are responsible for what happens under your account.
          ALPA is a business tool: you must be legally able to enter into a contract to use it.
        </p>
      </LegalSection>

      <LegalSection id="plans" title="Plans, usage and quotas">
        <p>The plans and prices are shown on the <Link href="/plans" className={link}>Plans</Link> page. At the time of writing:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Free: 25 businesses in total, for the lifetime of your account.</li>
          <li>ALPA Starter: $9.99 per month, 100 businesses per month.</li>
          <li>ALPA Pro: $24.99 per month, 500 businesses per month.</li>
        </ul>
        <p>
          Prices are in US dollars. If tax applies to your purchase, it is shown at checkout before you pay. The Plans page is the authority on current
          prices and allowances. Subscriptions on a plan we no longer offer continue with the allowance they were sold with for as long as they remain active.
        </p>
        <p>
          A quota counts businesses that ALPA delivers to your account. A business that has been delivered still counts if you later delete it from your
          lists. Paid allowances renew on the usage date shown in your account, and unused businesses do not carry over to the next period. The Free
          allowance does not renew.
        </p>
        <p>
          Paid features depend on your subscription being confirmed with our payment provider. If we cannot confirm it (for example during a provider
          outage), we may pause paid features until we can, rather than risk giving or denying access wrongly. Your saved businesses stay available.
        </p>
      </LegalSection>

      <LegalSection id="payment" title="Payment, cancellation and refunds">
        <p>
          Paid plans are monthly subscriptions, charged in advance through our payment provider, Stripe, on a Stripe-hosted checkout page. ALPA does not see
          or store your full card number. A subscription renews every month until you cancel it.
        </p>
        <p>
          You can cancel at any time from your billing page. Paid access continues until the end of the billing period you have already paid for.
          Payments are generally non-refundable, except where applicable law requires a refund or MINDRA expressly approves one. Nothing in these terms
          removes a right you have by law as a consumer. The details are in the{' '}
          <Link href="/refund-policy" className={link}>Refund and Cancellation Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="data" title="Business information and third-party data">
        <p>
          Business names, addresses, phone numbers, websites, ratings and categories come from third-party providers such as Google Places and Serper.
          Email addresses and other details may be found on the business’s own public website. This information is collected from sources we do not
          control. It can be out of date, incomplete or wrong, and we do not guarantee that it is accurate, complete or current.
        </p>
        <p>
          You are responsible for checking information before you rely on it, and for making sure that your use of it, including how you store and contact
          the people and businesses in it, follows the laws that apply to you and the terms of the sources it came from. We do not claim to own business
          information. You may keep and use the businesses delivered to you, including after a subscription ends, subject to these terms.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="AI-generated information">
        <p>
          Some features use an AI model to summarise what a business appears to do. These summaries are generated from public information and can be wrong,
          one-sided or out of date. They are not facts, advice or a prediction of results. Review them before you act on them, and do not use them to make
          decisions that significantly affect a person. The public information used for a summary may be processed by our AI provider; see the{' '}
          <Link href="/privacy" className={link}>Privacy Policy</Link>. AI features may be limited to some accounts or plans while they are being rolled out.
        </p>
      </LegalSection>

      <LegalSection id="use" title="Acceptable use and your responsibilities">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>use ALPA to break a law, including anti-spam, privacy and consumer-protection laws;</li>
          <li>harass, deceive or defraud anyone, or send unsolicited messages in a way the law does not allow;</li>
          <li>resell, republish or share ALPA data as a competing database or lead service;</li>
          <li>scrape, probe, overload or bypass the limits and security of ALPA, or share your account to avoid plan limits;</li>
          <li>upload or use data you have no right to use.</li>
        </ul>
        <p>We may suspend or close an account that breaks these terms or puts the service or others at risk.</p>
      </LegalSection>

      <LegalSection id="outreach" title="Contacting businesses">
        <p>
          The rules on contacting a business or a person by email, phone or text differ by country and by who is being contacted. You alone decide whom to
          contact and what to say, and you must follow the rules that apply, including identifying yourself, having a lawful basis or consent where
          required, and honouring unsubscribe and do-not-contact requests. ALPA provides information, not legal clearance to contact anyone.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="Availability and changes">
        <p>
          We work to keep ALPA available but do not promise that it will be uninterrupted or error free. Features, sources, plans and these terms can change.
          If a change is material we will give notice to account holders before it applies to them.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Warranty and liability">
        <p>
          ALPA is provided “as is” and “as available”. To the extent the law allows, we give no promise about results, about the accuracy of business information
          or about fitness for a particular purpose, and we are not liable for indirect or consequential loss, lost profit or lost business opportunity.
          To the extent the law allows, our total liability to you for claims connected with ALPA is limited to the amount you paid us for ALPA in the twelve
          months before the event giving rise to the claim.
        </p>
        <p>
          Nothing in these terms excludes or limits any liability or right that cannot be excluded or limited by law, including liability for intentional
          wrongdoing or gross negligence, for death or personal injury, and the mandatory rights of consumers.
        </p>
      </LegalSection>

      <LegalSection id="law" title="Governing law">
        <p>
          These terms are governed by the law of Estonia, subject to any mandatory consumer-protection rules of the country where you live that apply to you
          and cannot be excluded by agreement. If you are a consumer, you keep any right you have under mandatory law to bring a claim in the courts of the
          country where you live.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          For support, billing, refunds, privacy requests and account deletion, write to{' '}
          <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className={link}>{LEGAL_ENTITY.contactEmail}</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
