import Link from 'next/link'

import LegalDocument, { LegalSection, OwnerDecision, legalMetadata } from '@/components/legal/LegalDocument'

export const metadata = legalMetadata(
  'Privacy Policy',
  'What personal information ALPA collects, why, who it is shared with, and the choices you have.',
  '/privacy'
)

const contents = [
  { id: 'controller', title: 'Who is responsible' },
  { id: 'collect', title: 'What we collect' },
  { id: 'business-data', title: 'Business information in search results' },
  { id: 'use', title: 'How we use it' },
  { id: 'providers', title: 'Service providers' },
  { id: 'cookies', title: 'Cookies, storage and analytics' },
  { id: 'retention', title: 'How long we keep it' },
  { id: 'rights', title: 'Your choices and rights' },
  { id: 'security', title: 'Security' },
  { id: 'transfers', title: 'Where data is processed' },
  { id: 'children', title: 'Children' },
  { id: 'changes', title: 'Changes' },
  { id: 'contact', title: 'Contact' },
]

const providers: { name: string; role: string }[] = [
  { name: 'Supabase', role: 'database and sign-in (your account, saved businesses, usage records)' },
  { name: 'Vercel', role: 'hosting and delivery of the website and its server functions' },
  { name: 'Stripe', role: 'payments and subscriptions (card details are entered on Stripe, not on ALPA)' },
  { name: 'Resend', role: 'sending account emails such as confirmation and password reset' },
  { name: 'Google Places and Serper', role: 'finding businesses; they receive your search words and location, not your identity' },
  { name: 'OpenAI', role: 'AI summaries of public business information' },
  { name: 'Google Analytics', role: 'website statistics, only where it is switched on' },
]

export default function PrivacyPage() {
  return (
    <LegalDocument
      activePath="/privacy"
      title="Privacy Policy"
      intro="This policy explains what personal information ALPA handles, in two groups: information about you as a user, and information about the businesses ALPA finds for you."
      contents={contents}
    >
      <LegalSection id="controller" title="Who is responsible">
        <p>ALPA is a product of MINDRA and is responsible for the information described as “yours” below.</p>
        <OwnerDecision id="P1">
          Name the legal entity, its address and the person responsible for privacy (required by Quebec’s Law 25 and by privacy laws elsewhere).
          None is invented here.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="collect" title="What we collect">
        <p><strong className="text-white">Account.</strong> Your email address, your password (kept by our sign-in provider in protected form, never in readable form), when you signed up and your plan.</p>
        <p><strong className="text-white">What you do in ALPA.</strong> The searches you run (business type and location), the businesses you save, your lists and notes, your usage against your quota, and the actions that let us give you the product, such as exporting a CSV.</p>
        <p><strong className="text-white">Trial.</strong> Without an account, your trial results and a trial identifier are kept in your browser and on our servers so the results survive a reload and can be moved into an account if you sign up.</p>
        <p><strong className="text-white">Billing.</strong> Stripe handles your card. We keep identifiers that link your account to your Stripe customer and subscription, the plan, its status and renewal dates.</p>
        <p><strong className="text-white">Website activity.</strong> Pages and buttons used, the page you came from and campaign tags in the link (UTM), approximate device type and browser, used to understand which pages and plans work.</p>
        <p><strong className="text-white">Support.</strong> What you send us when you write to us.</p>
        <OwnerDecision id="P2">
          Confirm this list against what you want to collect, and decide whether IP addresses or server logs are kept and for how long.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="business-data" title="Business information in search results">
        <p>
          ALPA assembles information about businesses from third-party sources and from their public websites: names, addresses, phone
          numbers, websites, ratings, categories and email addresses. Some of it can identify a person, such as an email address for a sole
          proprietor. ALPA processes it to provide the service to you, and you are responsible for how you use it afterwards.
        </p>
        <p>If you are named in a result and want it removed, contact us as described below and we will review the request.</p>
        <OwnerDecision id="P3">
          This is the highest-risk privacy question in the product. A lawyer should confirm the lawful basis for collecting business contact
          data, whether a notice to the businesses is needed, a removal (opt-out) process and its response time, and the position for
          individuals in the EU, UK and Quebec.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="use" title="How we use it">
        <ul className="list-disc space-y-1 pl-6">
          <li>to run the service: sign you in, find and save businesses, apply your plan and quota, and export your lists;</li>
          <li>to take payment and manage your subscription;</li>
          <li>to send account emails (confirmation, password reset and billing messages) that you need;</li>
          <li>to keep ALPA secure, prevent abuse and fix problems;</li>
          <li>to understand usage and improve the product and its costs.</li>
        </ul>
        <p>We do not sell your personal information.</p>
        <OwnerDecision id="P4">
          Decide whether you will send product or marketing emails. None are sent today without separate approval, and any such email needs a
          consent and unsubscribe process. Confirm “we do not sell” is a promise you want to make.
        </OwnerDecision>
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
        <OwnerDecision id="P5">
          Confirm this list is complete and current when you publish, and whether data-processing agreements are in place with each provider.
          Review whether the AI provider may keep or train on inputs under your account terms.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies, storage and analytics">
        <p>
          ALPA uses cookies and browser storage that are needed to keep you signed in, hold your trial and remember your plan choice while you
          sign up. It also keeps campaign tags from the link you arrived on for the visit. Where website analytics is switched on, Google
          Analytics sets its own cookies and receives page and event data.
        </p>
        <OwnerDecision id="P6">
          Decide whether a cookie consent notice is required for the visitors you target, and whether analytics should wait for consent.
          Currently analytics loads whenever an analytics ID is configured.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep it">
        <OwnerDecision id="P7">
          Set the retention periods: account data after cancellation or deletion, an unclaimed trial, saved businesses, billing records (tax
          law usually requires some to be kept for years), and server logs. No periods are stated because none have been decided.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="rights" title="Your choices and rights">
        <p>
          You can ask to see, correct, export or delete the information we hold about you, or to object to or limit how it is used, subject
          to what the law requires us to keep. You can also cancel your subscription at any time (see the{' '}
          <Link href="/refund-policy" className="text-cyan-200 underline underline-offset-4">Refund and Cancellation Policy</Link>).
        </p>
        <OwnerDecision id="P8">
          State how requests are made, how identity is checked, the response time, and whether there is a self-service account deletion in
          the product (there is none today). Add the complaint route for your regulator.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          Sign-in is handled by a dedicated provider, data is held in an access-controlled database, payments run through Stripe, and
          connections use encryption in transit. No system is perfectly secure, and we cannot promise that information will never be accessed without permission.
        </p>
        <OwnerDecision id="P9">
          Decide the breach-notification commitment, and avoid stating security practices that are not in place.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="transfers" title="Where data is processed">
        <p>Our providers may process information in Canada, the United States and other countries.</p>
        <OwnerDecision id="P10">
          Confirm the actual hosting and database regions, and add the cross-border transfer wording your laws require.
        </OwnerDecision>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>ALPA is a business tool and is not directed at children. We do not knowingly collect their information.</p>
        <OwnerDecision id="P11">Confirm the age threshold (see Terms decision T2).</OwnerDecision>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>If we change this policy in a material way we will update the page and tell account holders. The date it last changed is shown below once it is published.</p>
        <OwnerDecision id="P12">Add the effective date at approval.</OwnerDecision>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <OwnerDecision id="P13">
          Provide the privacy contact email and postal address. None is invented here.
        </OwnerDecision>
      </LegalSection>
    </LegalDocument>
  )
}
