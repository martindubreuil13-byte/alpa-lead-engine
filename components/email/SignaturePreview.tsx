'use client'

import { buildSignatureHtml } from '@/lib/email/signature'

type Props = {
  senderName?: string
  jobTitle?: string
  companyName?: string
  phone?: string
  website?: string
  logoUrl?: string
  senderEmail?: string
}

export default function SignaturePreview({
  senderName,
  jobTitle,
  companyName,
  phone,
  website,
  logoUrl,
  senderEmail,
}: Props) {
  const hasContent =
    senderName || jobTitle || companyName || phone || website || senderEmail
  const signatureHtml = buildSignatureHtml({
    sender_name: senderName,
    job_title: jobTitle,
    company_name: companyName,
    phone,
    website,
    logo_url: logoUrl,
    sender_email: senderEmail,
  })

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 p-6">
      <div className="mb-4 text-xs uppercase tracking-wide text-slate-400">
        Signature Preview
      </div>

      {/* Email canvas */}
      <div
        className="mx-auto max-w-md rounded-lg p-6 shadow-2xl"
        style={{
          background: '#ffffff',
          color: '#1f2937',
        }}
      >
        {hasContent ? (
          <div
            className="text-sm leading-7"
            dangerouslySetInnerHTML={{ __html: signatureHtml }}
          />
        ) : (
          <div style={{ fontStyle: 'italic', opacity: 0.5 }}>
            Fill in your details to preview your signature
          </div>
        )}
      </div>
    </div>
  )
}
