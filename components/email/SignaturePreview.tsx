'use client'

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
          color: '#1f2937', // hard override dark text
        }}
      >
        <div style={{ borderTop: '1px solid #e5e7eb', marginBottom: 16 }} />

        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            {senderName && (
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {senderName}
              </div>
            )}

            {jobTitle && <div>{jobTitle}</div>}
            {companyName && <div>{companyName}</div>}

            {(phone || senderEmail || website) && (
              <div style={{ marginTop: 10, opacity: 0.8 }}>
                {phone && <div>{phone}</div>}
                {senderEmail && <div>{senderEmail}</div>}
                {website && <div>{website}</div>}
              </div>
            )}

            {!hasContent && (
              <div style={{ fontStyle: 'italic', opacity: 0.5 }}>
                Fill in your details to preview your signature
              </div>
            )}
          </div>

          {logoUrl && (
            <div>
              <img
                src={logoUrl}
                alt="Logo"
                style={{ maxHeight: 60, maxWidth: 140, objectFit: 'contain' }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}