'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import SignaturePreview from '@/components/email/SignaturePreview'

type SenderSettingsRow = {
  id: string
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
    const { data, error } = await supabase
      .from('sender_settings')
      .select('id, sender_name, sender_email, company_name, job_title, phone, website, logo_url')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error(error)
      return
    }

    if (data) {
      const row = data as SenderSettingsRow
      setRowId(row.id)
      setSenderName(row.sender_name || '')
      setSenderEmail(row.sender_email || '')
      setCompanyName(row.company_name || '')
      setJobTitle(row.job_title || '')
      setPhone(row.phone || '')
      setWebsite(row.website || '')
      setLogoUrl(row.logo_url || '')
    }
  }

  async function saveSettings() {
    setLoading(true)

    const payload = {
      sender_name: senderName || null,
      sender_email: senderEmail || null,
      company_name: companyName || null,
      job_title: jobTitle || null,
      phone: phone || null,
      website: website || null,
      logo_url: logoUrl || null,
    }

    let error = null

    if (rowId) {
      const result = await supabase
        .from('sender_settings')
        .update(payload)
        .eq('id', rowId)

      error = result.error
    } else {
      const result = await supabase
        .from('sender_settings')
        .insert(payload)
        .select('id')
        .single()

      error = result.error
      if (result.data?.id) setRowId(result.data.id)
    }

    setLoading(false)

    if (error) {
      console.error(error)
      alert('Error saving settings')
    } else {
      alert('Settings saved successfully')
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setLogoFileName(file.name)
    setUploading(true)

    const ext = file.name.split('.').pop() || 'png'
    const filePath = `logo-${Date.now()}.${ext}`

    const { data, error } = await supabase.storage
      .from('logos')
      .upload(filePath, file, { upsert: true })

    setUploading(false)

    if (error) {
      console.error(error)
      alert('Logo upload failed')
      return
    }

    const { data: publicUrlData } = supabase.storage
      .from('logos')
      .getPublicUrl(data.path)

    setLogoUrl(publicUrlData.publicUrl)
  }

  function removeLogo() {
    setLogoUrl('')
    setLogoFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-3xl font-semibold text-white">Email Settings</h1>
        <p className="mt-2 text-slate-400">
          Configure sender identity and signature
        </p>
      </div>

      <div className="glass space-y-8 p-8">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Sender Identity</h2>

          <div className="grid gap-4 md:grid-cols-2">
            <input
              placeholder="Full Name"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="input"
            />

            <input
              placeholder="Job Title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="input"
            />

            <input
              placeholder="Sender Email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              className="input"
            />

            <input
              placeholder="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
            />

            <input
              placeholder="Company Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="input"
            />

            <input
              placeholder="Website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="input"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Company Logo</h2>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10">
            <span className="truncate text-sm text-slate-300">
              {logoFileName || 'Upload logo image'}
            </span>

            <span className="rounded bg-blue-600 px-3 py-1 text-xs text-white">
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
            <div className="flex items-center gap-4">
              <img
                src={logoUrl}
                alt="Logo preview"
                className="h-16 rounded bg-white p-2 object-contain"
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

        <SignaturePreview
          senderName={senderName}
          jobTitle={jobTitle}
          companyName={companyName}
          phone={phone}
          website={website}
          logoUrl={logoUrl}
          senderEmail={senderEmail}
        />

        <div>
          <button
            onClick={saveSettings}
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}