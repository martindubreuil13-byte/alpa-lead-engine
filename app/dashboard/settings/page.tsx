'use client'

import { useEffect, useRef, useState } from 'react'

import SignaturePreview from '@/components/email/SignaturePreview'
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

export default function SettingsPage() {
  const [rowId, setRowId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

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
    fetchSettings()
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

    if (error) {
      console.error('Error fetching sender settings:', error)
      return
    }

    if (!data) return

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

      console.log('Saving sender settings for user:', user.id)

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
        .single()

      if (error) {
        console.error('FULL ERROR:', JSON.stringify(error, null, 2))
        setStatusMessage('Unable to save sender settings.')
        return
      }

      if (data?.id) {
        setRowId(data.id)
      }

      console.log('Sender settings saved')
      setStatusMessage('Sender settings saved successfully.')
    } catch (error) {
      console.error('FULL ERROR:', JSON.stringify(error, null, 2))
      setStatusMessage('You must be logged in to save sender settings.')
    } finally {
      setLoading(false)
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
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

    const { data: publicUrlData } = supabase.storage
      .from('logos')
      .getPublicUrl(data.path)

    setLogoUrl(publicUrlData.publicUrl)
    setStatusMessage('Logo uploaded successfully.')
  }

  function removeLogo() {
    setLogoUrl('')
    setLogoFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-white">Sender Settings</h1>
        <p className="text-slate-400">
          Save the sender identity that will be attached automatically to every outreach email.
        </p>
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="glass space-y-8 rounded-3xl p-8">
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Sender Identity</h2>
              <p className="mt-1 text-sm text-slate-400">
                These details are used to generate your email signature automatically.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Sender name</span>
                <input
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="Martin Reynolds"
                  className="input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-slate-300">Job title</span>
                <input
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Founder"
                  className="input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-slate-300">Company name</span>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ALPA"
                  className="input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-slate-300">Sender email</span>
                <input
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="martin@alpa.ai"
                  className="input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-slate-300">Phone</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-slate-300">Website</span>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="www.alpa.ai"
                  className="input"
                />
              </label>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Company Logo</h2>
              <p className="mt-1 text-sm text-slate-400">
                Upload an image or paste a public logo URL.
              </p>
            </div>

            <label className="space-y-2">
              <span className="text-sm text-slate-300">Logo URL</span>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="input"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10">
              <span className="truncate text-sm text-slate-300">
                {logoFileName || 'Upload logo image'}
              </span>

              <span className="rounded-lg bg-blue-600 px-3 py-1 text-xs text-white">
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

            {logoUrl && (
              <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="h-16 rounded-xl bg-white p-2 object-contain"
                />
                <button
                  type="button"
                  onClick={removeLogo}
                  className="rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-300 hover:bg-red-500/30"
                >
                  Remove Logo
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={saveSettings}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Sender Settings'}
            </button>

            {statusMessage && (
              <p className="text-sm text-slate-300">{statusMessage}</p>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="glass rounded-3xl p-8">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Signature Preview</h2>
              <p className="mt-1 text-sm text-slate-400">
                This is the signature HTML that will be appended to your saved template.
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
          </div>
        </section>
      </div>
    </div>
  )
}
