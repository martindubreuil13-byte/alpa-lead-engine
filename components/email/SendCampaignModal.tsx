'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Template = {
  id: string
  name: string
  subject: string
  body: string
}

export default function SendCampaignModal({
  isOpen,
  onClose,
  selectedIds,
  onSent,
}: {
  isOpen: boolean
  onClose: () => void
  selectedIds: string[]
  onSent: () => void
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) fetchTemplates()
  }, [isOpen])

  async function fetchTemplates() {
    const { data } = await supabase
      .from('email_templates')
      .select('id, name, subject, body')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (data) setTemplates(data)
  }

  function handleTemplateChange(id: string) {
    setSelectedTemplateId(id)
    const t = templates.find(t => t.id === id) || null
    setSelectedTemplate(t)
  }

  async function sendCampaign() {
    if (!selectedTemplateId || selectedIds.length === 0) return
    setLoading(true)

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadIds: selectedIds,
        templateId: selectedTemplateId,
      }),
    })

    setLoading(false)

    if (res.ok) {
      onSent()
      onClose()
    } else {
      alert('Failed to send emails')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass w-full max-w-2xl space-y-6 p-8">

        <h2 className="text-2xl font-semibold text-white">
          Send Campaign
        </h2>

        <div className="text-sm text-slate-400">
          {selectedIds.length} lead{selectedIds.length > 1 && 's'} selected
        </div>

        <select
          value={selectedTemplateId}
          onChange={(e) => handleTemplateChange(e.target.value)}
          className="w-full rounded-lg bg-white/10 p-3 text-white outline-none ring-1 ring-white/10 focus:ring-blue-500/40"
        >
          <option value="">Select Template</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {selectedTemplate && (
          <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Subject
              </div>
              <div className="mt-1 text-white">
                {selectedTemplate.subject}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Email Preview
              </div>
              <div
                className="mt-2 max-h-60 overflow-y-auto rounded-lg bg-black/30 p-4 text-sm text-slate-200"
                dangerouslySetInnerHTML={{ __html: selectedTemplate.body }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-white/10 px-4 py-2 text-slate-300 transition hover:bg-white/20"
          >
            Cancel
          </button>

          <button
            disabled={!selectedTemplateId || loading}
            onClick={sendCampaign}
            className={`rounded-lg px-6 py-2 text-white transition ${
              !selectedTemplateId || loading
                ? 'bg-blue-900/40 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? 'Sending...' : 'Send Emails'}
          </button>
        </div>
      </div>
    </div>
  )
}