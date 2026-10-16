import Link from 'next/link'

import LegalDocument, { LegalSection, OwnerDecision, legalMetadata } from '@/components/legal/LegalDocument'

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
  { id: 'data', title: 'Business information and third-party data' },
  { id: 'ai', title: 'AI-generated information' },
  { id: 'use', title: 'Acceptable use and your responsibilities' },
  { id: 'outreach', title: 'Contacting businesses' },
  { id: 'payment', title: 'Payment, cancellation and refunds' },
  { id: 'availability', title: 'Availability and changes' },
  { id: 'liability', title: 'Warranty and liability' },
  { id: 'law', title: 'Governing law and disputes' },
  { id: 'contact', title: 'Contact' },
]

export default function TermsPage() {
  return (
    <LegalDocument
      activePath="/terms"
      title="Terms of Service"
      intro="These terms apply when you use ALPA, a service that helps you find businesses, review the contact information and research available about them, and export your lists."
      contents={contents}
    >
      <LegalSection id="who" title="Who provides ALPA">
        <p>ALPA is a product of MINDRA. In these terms, “ALPA”, “we” and “us” mean the business that provides it.</p>
        <OwnerDecision id="T1">
          Name the legal entity that contracts with customers (registered name, legal form, registration number, registered address and
          country), and say whether sales tax applies and how it is shown. Nothing is filled in here because it has not been confirmed.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="service" title="What ALPA does">
        <p>
          You describe the kind of business and the place you are interested in. ALPA searches business listings from third-party
          providers, visits public business websites to look for contact details such as an email address or phone number, and can prepare a
          short written summary of what a business appears to do. You can save the results to your account and export them as a CSV file.
        </p>
        <p>ALPA does not send messages on your behalf unless you explicitly use a feature that says it does, and it does not guarantee that any business will respond or become a customer.</p>
      </LegalSection>

      <LegalSection id="accounts" title="Accounts and the free trial">
        <p>
          You can try ALPA without an account. A trial lets you see up to 25 businesses. The trial is kept in your browser and, while it
          lasts, on our servers, and when you create an account we offer to move the businesses you found into it.
        </p>
        <p>
          To keep results, use paid plans or access your account later, you need an account. You must give an email address you control,
          keep your password confidential, and tell us if you think someone else has accessed your account. You are responsible for what
          happens under your account.
        </p>
        <OwnerDecision id="T2">
          Confirm the minimum age to hold an account, whether business use only is intended, and how long an inactive free account or
          unclaimed trial is kept before it is deleted.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="plans" title="Plans, usage and quotas">
        <p>The plans and prices are shown on the <Link href="/plans" className="text-cyan-200 underline underline-offset-4">Plans</Link> page. At the time of writing:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Free: 25 businesses in total, one time.</li>
          <li>ALPA Starter: 100 businesses per month.</li>
          <li>ALPA Pro: 500 businesses per month.</li>
        </ul>
        <p>
          A quota counts businesses that ALPA delivers to you. Paid allowances renew on the usage date shown in your account, and unused
          businesses do not carry over to the next period. Accounts on plans that are no longer offered keep the allowance they were sold
          with for as long as the subscription continues.
        </p>
        <p>The Plans page is the authority on current prices and allowances. If ALPA cannot confirm your current plan with its payment provider, it may pause paid features until it can, rather than risk giving or denying access wrongly.</p>
        <OwnerDecision id="T3">
          Decide and state: whether businesses you delete from your lists still count toward your quota; how a lifetime free allowance is
          treated if you delete and recreate an account; what happens when you reach your quota mid-period (stop, or offer an upgrade); how
          much notice you will give before changing prices or allowances for existing subscribers; and whether currency, taxes and the
          monthly window follow the calendar month or the billing date.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="data" title="Business information and third-party data">
        <p>
          Business names, addresses, phone numbers, websites, ratings and categories come from third-party providers such as Google Places
          and Serper. Email addresses and other details may be found on the business’s own public website. This information is
          collected from sources we do not control. It can be out of date, incomplete or wrong, and we do not guarantee its accuracy,
          completeness or that it is current.
        </p>
        <p>
          You are responsible for checking information before you rely on it, and for making sure that your use of it, including how you store and
          contact the people and businesses in it, follows the laws that apply to you and the terms of the sources it came from. We do not
          claim to own business information and we do not verify that any address belongs to the person who reads it.
        </p>
        <OwnerDecision id="T4">
          Confirm that the data providers’ own terms allow what ALPA does with their data (storing, exporting to CSV and keeping it after a
          subscription ends), and whether any attribution or display rule has to be added here.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="ai" title="AI-generated information">
        <p>
          Some features use an AI model to summarise what a business appears to do or to suggest how to approach it. These outputs are
          generated from public information and can be wrong, one-sided or out of date. They are not facts, advice or a prediction of
          results. Review them before you act on them, and do not use them to make decisions that significantly affect a person.
        </p>
        <p>Text you or the business supplies for these features may be processed by our AI provider to produce the output; see the <Link href="/privacy" className="text-cyan-200 underline underline-offset-4">Privacy Policy</Link>.</p>
        <OwnerDecision id="T5">
          Decide which plans include AI research and any limit on it. The current setup limits AI research to approved accounts while it is
          being tested, so describe availability only once it is settled.
        </OwnerDecision>
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
        <OwnerDecision id="T6">
          Decide the process and notice for suspension, and whether data can be exported by a suspended or cancelled customer.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="outreach" title="Contacting businesses">
        <p>
          The rules on contacting a business or a person by email, phone or text differ by country and by who is being contacted. You alone
          decide whom to contact and what to say, and you must follow the rules that apply, including identifying yourself, having a lawful basis
          or consent where required, and honouring unsubscribe and do-not-contact requests. ALPA provides information, not legal clearance to contact anyone.
        </p>
        <OwnerDecision id="T7">
          Have a lawyer confirm the wording for the countries you serve (for example Canada’s anti-spam law, CAN-SPAM in the United States and
          the GDPR in Europe) and whether ALPA targets customers outside Canada and the United States.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="payment" title="Payment, cancellation and refunds">
        <p>
          Paid plans are subscriptions billed monthly in advance through our payment provider, Stripe. You pay on a Stripe-hosted checkout
          page; ALPA does not see or store your full card number. You can cancel from your billing page at any time; the cancellation takes
          effect at the end of the period you have already paid for. Refunds and further detail are in the{' '}
          <Link href="/refund-policy" className="text-cyan-200 underline underline-offset-4">Refund and Cancellation Policy</Link>, which forms
          part of these terms.
        </p>
        <OwnerDecision id="T8">
          Confirm that subscriptions renew automatically until cancelled, the currency charged, and the consumer-law renewal and
          cancellation notices required in the places you sell to.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="availability" title="Availability and changes">
        <p>
          We work to keep ALPA available but do not promise it will be uninterrupted or error free. Features, sources, plans and these
          terms can change. If a change is material we will tell account holders before it applies to them.
        </p>
        <OwnerDecision id="T9">
          Decide the notice period for material changes and whether customers may cancel with a refund if they do not accept one.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="liability" title="Warranty and liability">
        <p>ALPA is provided “as is”, without promises about results, accuracy of business information or fitness for a particular purpose, to the extent the law allows. Nothing in these terms limits rights that cannot be limited by law.</p>
        <OwnerDecision id="T10">
          A lawyer must write the limitation of liability, including any cap, the exclusion of indirect loss, and any indemnity from you for
          misuse. Nothing is invented here.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="law" title="Governing law and disputes">
        <OwnerDecision id="T11">
          Choose the governing law, the courts or arbitration venue and the language of the contract. Quebec and consumer-protection rules may
          limit what can be chosen; take advice before filling this in.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <OwnerDecision id="T12">
          Provide a monitored contact email for legal and billing matters and the postal address that must appear here. None is invented.
        </OwnerDecision>
      </LegalSection>
    </LegalDocument>
  )
}
