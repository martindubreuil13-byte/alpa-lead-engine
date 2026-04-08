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
  const hasContent = senderName || jobTitle || companyName || phone || website || senderEmail
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
    <div className="space-y-4">
      <div className="rounded-[24px] border border-white/8 bg-[#081120]/80 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          Signature preview
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Review the exact signature block that ALPA appends to your emails.
        </p>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-white/8 bg-[#081120]/80 p-3 sm:p-4">
        <div className="rounded-[24px] bg-white p-5 shadow-[0_24px_48px_rgba(15,23,42,0.2)] sm:p-6">
          {hasContent ? (
            <div
              className="break-words text-sm leading-7 text-slate-800"
              dangerouslySetInnerHTML={{ __html: signatureHtml }}
            />
          ) : (
            <div className="text-sm italic text-slate-400">
              Fill in your details to preview your signature.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
