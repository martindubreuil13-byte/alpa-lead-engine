'use client'

import { useEffect, useRef, useState } from 'react'

import SignaturePreview from '@/components/email/SignaturePreview'
import { isIgnorableEmptyResultError } from '@/lib/supabase/errors'
import { supabase } from '@/lib/supabase'

type SenderSettingsRow = {
  id: string
  user_id: string
  sender_name: string | null
  sender_email: string | null
  company_name: string | null
  job_title: string | null
  phone: string | null
  website: string | null
  logo_url: string | null
}

type ViewMode = 'form' | 'preview'

export default function SettingsPage() {
  const [rowId, setRowId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('form')

  const [senderName, setSenderName] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoFileName, setLogoFileName] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void fetchSettings()
  }, [])

  async function fetchSettings() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      console.error('Unable to resolve authenticated user:', userError)
      return
    }

    const { data, error } = await supabase
      .from('sender_settings')
      .select('id, user_id, sender_name, sender_email, company_name, job_title, phone, website, logo_url')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error && !isIgnorableEmptyResultError(error)) {
      console.error('Error fetching sender settings:', JSON.stringify(error, null, 2))
      return
    }

    if (!data) {
      setRowId(null)
      setSenderName('')
      setSenderEmail('')
      setCompanyName('')
      setJobTitle('')
      setPhone('')
      setWebsite('')
      setLogoUrl('')
      setLogoFileName('')
      return
    }

    const row = data as SenderSettingsRow
    setRowId(row.id)
    setSenderName(row.sender_name || '')
    setSenderEmail(row.sender_email || '')
    setCompanyName(row.company_name || '')
    setJobTitle(row.job_title || '')
    setPhone(row.phone || '')
    setWebsite(row.website || '')
    setLogoUrl(row.logo_url || '')

    if (row.logo_url) {
      const parts = row.logo_url.split('/')
      setLogoFileName(parts[parts.length - 1] || '')
    }
  }

  async function saveSettings() {
    setLoading(true)
    setStatusMessage('')

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        throw userError
      }

      if (!user?.id) {
        throw new Error('Missing authenticated user')
      }

      const { data, error } = await supabase
        .from('sender_settings')
        .upsert(
          {
            user_id: user.id,
            sender_name: senderName.trim() || null,
            job_title: jobTitle.trim() || null,
            company_name: companyName.trim() || null,
            sender_email: senderEmail.trim() || null,
            phone: phone.trim() || null,
            website: website.trim() || null,
            logo_url: logoUrl.trim() || null,
          },
          {
            onConflict: 'user_id',
          }
        )
        .select('id')
        .maybeSingle()

      if (error) {
        console.error('FULL ERROR:', JSON.stringify(error, null, 2))
        setStatusMessage('Unable to save sender settings.')
        return
      }

      if (data?.id) {
        setRowId(data.id)
      }

      setStatusMessage('Sender settings saved successfully.')
    } catch (error) {
      console.error('FULL ERROR:', JSON.stringify(error, null, 2))
      setStatusMessage('You must be logged in to save sender settings.')
    } finally {
      setLoading(false)
    }
  }

  async function uploadLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      setStatusMessage('You must be logged in to upload a logo.')
      return
    }

    setLogoFileName(file.name)
    setUploading(true)
    setStatusMessage('')

    const ext = file.name.split('.').pop() || 'png'
    const filePath = `${user.id}/logo-${Date.now()}.${ext}`

    const { data, error } = await supabase.storage
      .from('logos')
      .upload(filePath, file, { upsert: true })

    setUploading(false)

    if (error) {
      console.error('Logo upload failed:', error)
      setStatusMessage('Logo upload failed.')
      return
    }

    const { data: publicUrlData } = supabase.storage.from('logos').getPublicUrl(data.path)

    setLogoUrl(publicUrlData.publicUrl)
    setStatusMessage('Logo uploaded successfully.')
  }

  function removeLogo() {
    setLogoUrl('')
    setLogoFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-6 pb-4">
      <header className="glass p-5 sm:p-6">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100/70">
            Signature setup
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Sender Settings
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            Save the identity and branding details ALPA uses in your outreach. The form stays single-column on mobile and the preview stays one tap away.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatCard label="Profile status" value={rowId ? 'Saved' : 'Draft'} />
          <StatCard label="Logo" value={logoUrl ? 'Added' : 'Optional'} />
          <StatCard label="Preview" value={senderName || companyName ? 'Ready' : 'Waiting'} />
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          <section className="glass p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Sender profile</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Update your sender identity and signature details with touch-friendly fields.
                </p>
              </div>

              <div className="inline-flex rounded-2xl border border-white/10 bg-[#081120]/80 p-1 xl:hidden">
                {(['form', 'preview'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`min-h-[40px] rounded-xl px-4 text-sm font-medium transition ${
                      viewMode === mode
                        ? 'bg-emerald-400/12 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'form' ? 'Form' : 'Preview'}
                  </button>
                ))}
              </div>
            </div>

            <div className={viewMode === 'preview' ? 'hidden xl:block' : 'mt-6 space-y-6'}>
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Identity</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    These details power your signature and template sends.
                  </p>
                </div>

                <div className="space-y-4">
                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Sender name</span>
                    <input
                      value={senderName}
                      onChange={(event) => setSenderName(event.target.value)}
                      placeholder="Martin Reynolds"
                      className="input"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Job title</span>
                    <input
                      value={jobTitle}
                      onChange={(event) => setJobTitle(event.target.value)}
                      placeholder="Founder"
                      className="input"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Company name</span>
                    <input
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      placeholder="ALPA"
                      className="input"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Sender email</span>
                    <input
                      value={senderEmail}
                      onChange={(event) => setSenderEmail(event.target.value)}
                      placeholder="martin@alpa.ai"
                      className="input"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Phone</span>
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="+1 555 123 4567"
                      className="input"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Website</span>
                    <input
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                      placeholder="www.alpa.ai"
                      className="input"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-4 border-t border-white/8 pt-6">
                <div>
                  <h3 className="text-base font-semibold text-white">Logo</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Upload an image or paste a public logo URL.
                  </p>
                </div>

                <label className="space-y-2">
                  <span className="text-sm text-slate-300">Logo URL</span>
                  <input
                    value={logoUrl}
                    onChange={(event) => setLogoUrl(event.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="input"
                  />
                </label>

                <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:bg-white/[0.06]">
                  <span className="min-w-0 truncate text-sm text-slate-300">
                    {logoFileName || 'Upload logo image'}
                  </span>

                  <span className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-medium text-emerald-100">
                    {uploading ? 'Uploading...' : 'Browse'}
                  </span>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={uploadLogo}
                    className="hidden"
                  />
                </label>

                {logoUrl ? (
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <img
                        src={logoUrl}
                        alt="Logo preview"
                        className="h-20 w-20 rounded-2xl bg-white p-2 object-contain"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-slate-300">{logoFileName || 'Current logo'}</div>
                        <div className="mt-1 text-xs text-slate-500">This will be added beneath your signature details.</div>
                      </div>
                      <button
                        type="button"
                        onClick={removeLogo}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-rose-300/14 bg-rose-400/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-400/16"
                      >
                        Remove logo
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 xl:bottom-6">
            <div className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">Save sender settings</div>
                {statusMessage ? (
                  <p className="mt-1 text-sm text-slate-300">{statusMessage}</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Your save button stays close while you work through the form on mobile.
                  </p>
                )}
              </div>

              <button type="button" onClick={saveSettings} disabled={loading} className="btn-primary w-full sm:w-auto">
                {loading ? 'Saving...' : 'Save sender settings'}
              </button>
            </div>
          </div>
        </div>

        <div className={viewMode === 'form' ? 'hidden xl:block' : 'space-y-4'}>
          <section className="glass p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-white">Signature preview</h2>
              <p className="mt-1 text-sm text-slate-400">
                This signature preview updates with your sender details and stays easy to read on small screens.
              </p>
            </div>

            <SignaturePreview
              senderName={senderName}
              jobTitle={jobTitle}
              companyName={companyName}
              phone={phone}
              website={website}
              logoUrl={logoUrl}
              senderEmail={senderEmail}
            />
          </section>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-3 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}
