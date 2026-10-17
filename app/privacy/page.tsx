import Link from 'next/link'

import LegalDocument, { LegalSection, legalMetadata } from '@/components/legal/LegalDocument'
import { LEGAL_ENTITY } from '@/lib/legal'

export const metadata = legalMetadata(
  'Privacy Policy',
  'What personal information ALPA collects, why, who it is shared with, and the choices you have.',
  '/privacy'
)

const contents = [
  { id: 'controller', title: 'Who is responsible' },
  { id: 'collect', title: 'What we collect about you' },
  { id: 'business-data', title: 'Business information in search results' },
  { id: 'use', title: 'How we use it and why' },
  { id: 'providers', title: 'Service providers' },
  { id: 'transfers', title: 'Where data is processed' },
  { id: 'cookies', title: 'Cookies, storage and analytics' },
  { id: 'retention', title: 'How long we keep it' },
  { id: 'rights', title: 'Your rights and how to use them' },
  { id: 'security', title: 'Security' },
  { id: 'children', title: 'Children' },
  { id: 'changes', title: 'Changes' },
  { id: 'contact', title: 'Contact and complaints' },
]

const providers: { name: string; role: string }[] = [
  { name: 'Supabase', role: 'database and sign-in (your account, saved businesses, usage records)' },
  { name: 'Vercel', role: 'hosting and delivery of the website and its server functions' },
  { name: 'Stripe', role: 'payments and subscriptions (card details are entered on Stripe, not on ALPA)' },
  { name: 'Resend', role: 'sending account emails such as confirmation and password reset' },
  { name: 'Google Places and Serper', role: 'finding businesses; they receive your search words and location, not your identity' },
  { name: 'OpenAI', role: 'AI summaries of public business information' },
  { name: 'Google Analytics', role: 'website statistics' },
]

const link = 'text-cyan-200 underline underline-offset-4'
const mail = (
  <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className={link}>{LEGAL_ENTITY.contactEmail}</a>
)

export default function PrivacyPage() {
  return (
    <LegalDocument
      activePath="/privacy"
      title="Privacy Policy"
      intro="This policy explains what personal information ALPA handles, in two groups: information about you as a user, and information about the businesses ALPA finds for you."
      contents={contents}
    >
      <LegalSection id="controller" title="Who is responsible">
        <p>
          The controller of your personal information is {LEGAL_ENTITY.name} (registry code {LEGAL_ENTITY.registryCode}, registration number{' '}
          {LEGAL_ENTITY.registrationNumber}), {LEGAL_ENTITY.address}. Contact for all privacy matters: {mail}.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="What we collect about you">
        <p><strong className="text-white">Account.</strong> Your email address, your password (kept by our sign-in provider in protected form, never in readable form), when you signed up and your plan.</p>
        <p><strong className="text-white">What you do in ALPA.</strong> The searches you run (business type and location), the businesses you save, your lists and notes, your usage against your quota, and the actions that let us give you the product, such as exporting a CSV.</p>
        <p><strong className="text-white">Trial.</strong> Without an account, your trial results and a trial identifier are kept in your browser and on our servers so that the results survive a reload and can be moved into an account if you sign up.</p>
        <p><strong className="text-white">Billing.</strong> Stripe handles your card. We keep identifiers that link your account to your Stripe customer and subscription, the plan, its status and renewal dates.</p>
        <p><strong className="text-white">Website activity.</strong> Pages and buttons used, the page you came from, campaign tags in the link (UTM), and approximate device type and browser, so that we can understand which pages and plans work and keep the service running.</p>
        <p><strong className="text-white">Support.</strong> What you send us when you write to us.</p>
      </LegalSection>

      <LegalSection id="business-data" title="Business information in search results">
        <p>
          ALPA assembles information about businesses from third-party sources and from their public websites: names, addresses, phone numbers, websites,
          ratings, categories and email addresses. Some of it can identify a person, for example an email address of a sole trader. We process it to provide
          the service to you; you are responsible for how you use it afterwards (see the <Link href="/terms" className={link}>Terms of Service</Link>).
        </p>
        <p>
          If you are named in a result and want it corrected or removed, write to {mail}. We will review the request and act on it as the law requires.
          Removing a business from ALPA’s results does not remove it from the third-party sources it came from.
        </p>
      </LegalSection>

      <LegalSection id="use" title="How we use it and why">
        <ul className="list-disc space-y-1 pl-6">
          <li>to run the service you asked for (sign you in, find and save businesses, apply your plan and quota, export your lists) and to take payment and manage your subscription. Basis: performing our contract with you;</li>
          <li>to keep ALPA secure, prevent abuse, fix problems and understand how it is used. Basis: our legitimate interests in a safe and working service;</li>
          <li>to provide business information to our customers for B2B prospecting. Basis: our and our customers’ legitimate interests, balanced against the rights of the people concerned, who can object as described above;</li>
          <li>to keep payment and accounting records. Basis: our legal obligations;</li>
          <li>to set analytics cookies, where that requires your consent. Basis: your consent.</li>
        </ul>
        <p>We send you account emails (confirmation, password reset and billing messages) that you need to use the service. We do not send marketing emails, and we do not sell your personal information.</p>
      </LegalSection>

      <LegalSection id="providers" title="Service providers">
        <p>We share information with the companies that help us run ALPA, only as needed for the role listed:</p>
        <ul className="space-y-2">
          {providers.map((provider) => (
            <li key={provider.name} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6">
              <span className="font-semibold text-white">{provider.name}</span> — {provider.role}
            </li>
          ))}
        </ul>
        <p>We may also disclose information where the law requires it or to protect our rights, and to a successor if the business is sold.</p>
      </LegalSection>

      <LegalSection id="transfers" title="Where data is processed">
        <p>
          Our database is hosted by Supabase in the United States. Our other providers may also process information outside the European Economic Area.
          Where we transfer personal information outside the EEA, we rely on a safeguard the GDPR allows for that transfer, such as an adequacy decision or
          standard contractual clauses. You can ask us for information about these safeguards.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies, storage and analytics">
        <p>
          ALPA uses cookies and browser storage that are needed to keep you signed in, hold your trial and remember your plan choice while you sign up.
          It also keeps campaign tags from the link you arrived on for the length of the visit. Where Google Analytics is switched on, it sets its own cookies and
          receives page and event data about your visit.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep it">
        <p>
          We keep your account and your saved business data while your account is open. If you ask us to delete your account we delete your personal
          information and the saved data linked to it, except records we are legally required to keep. Payment and accounting records are kept for as long
          as the law requires. Trial results that are not moved into an account are kept only as long as needed to run the trial.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="Your rights and how to use them">
        <p>
          Under the GDPR you can ask us for access to your personal information, to correct it, to delete it, to restrict or object to how we use it, and to
          receive it in a portable form. Where we rely on your consent you can withdraw it at any time. You can also cancel your subscription at any time (see the{' '}
          <Link href="/refund-policy" className={link}>Refund and Cancellation Policy</Link>).
        </p>
        <p>
          To use any of these rights, including account deletion, email {mail}. At present these requests are handled by our team on request; there is no
          self-service deletion button in the product. We may need to confirm that the request comes from the account holder. We respond within the time the law
          requires.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          Sign-in is handled by a dedicated provider, data is held in an access-controlled database where each customer can read only their own records, payments
          run through Stripe, and connections use encryption in transit. No system is perfectly secure, and we cannot promise that information will never be
          accessed without permission. Where the law requires it, we will notify the authority and the people affected of a breach.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>ALPA is a business tool and is not directed at children. We do not knowingly collect their information.</p>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>If we change this policy in a material way we will update this page and give notice to account holders. The date of the latest update is shown at the top.</p>
      </LegalSection>

      <LegalSection id="contact" title="Contact and complaints">
        <p>
          Privacy questions and requests: {mail}. {LEGAL_ENTITY.name}, {LEGAL_ENTITY.address}. If you are not satisfied with our answer you can complain to the
          Estonian Data Protection Inspectorate (Andmekaitse Inspektsioon, aki.ee) or to the data-protection authority of the country where you live or work.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
