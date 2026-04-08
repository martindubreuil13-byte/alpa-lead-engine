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
          Preview
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Review the exact signature block that ALPA appends to your emails.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#020617] p-4 shadow-[0_18px_40px_rgba(2,8,23,0.24)]">
        <div className="rounded-xl border border-white/8 bg-[#081120] p-5 sm:p-6">
          {hasContent ? (
            <div
              className="break-words text-sm leading-7 text-slate-100 [&_a]:text-emerald-300 [&_a]:underline-offset-2 hover:[&_a]:text-emerald-200 [&_img]:rounded-xl [&_img]:bg-white/5 [&_img]:p-2"
              style={{ color: '#e2e8f0', backgroundColor: 'transparent' }}
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
