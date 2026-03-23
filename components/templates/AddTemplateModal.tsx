'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import RichTextEditor from '@/components/editor/RichTextEditor'

type Template = {
  id: string
  user_id: string
  name: string
  subject: string
  body: string
  signature: string | null
  created_at: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  editTemplate?: Template | null
}

export default function AddTemplateModal({
  isOpen,
  onClose,
  onCreated,
  editTemplate,
}: Props) {
  const isEditMode = !!editTemplate

  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [signature, setSignature] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (editTemplate) {
      setName(editTemplate.name)
      setSubject(editTemplate.subject)
      setBody(editTemplate.body)
      setSignature(editTemplate.signature || '')
    } else {
      setName('')
      setSubject('')
      setBody('')
      setSignature('')
    }
  }, [editTemplate, isOpen])

  if (!isOpen) return null

  async function handleSave() {
    if (!name.trim() || !subject.trim() || !body.trim()) {
      alert('Name, subject and body are required')
      return
    }

    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      setLoading(false)
      alert('You must be logged in to save templates')
      return
    }

    const payload = {
      name: name.trim(),
      subject: subject.trim(),
      body,
      signature: signature.trim() || null,
    }

    let error = null

    if (isEditMode) {
      const result = await supabase
        .from('templates')
        .update(payload)
        .eq('id', editTemplate!.id)
        .eq('user_id', user.id)

      error = result.error
    } else {
      const result = await supabase.from('templates').insert({
        ...payload,
        user_id: user.id,
      })

      error = result.error
    }

    setLoading(false)

    if (error) {
      console.error('Template save failed:', error)
      alert('Error saving template')
      return
    }

    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
        <h2 className="mb-6 text-2xl font-semibold text-white">
          {isEditMode ? 'Edit Email Template' : 'Create Email Template'}
        </h2>

        <div className="grid gap-5">
          <input
            placeholder="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
          />

          <input
            placeholder="Email subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
          />

          <div>
            <div className="mb-2 text-sm text-slate-400">Email Body</div>
            <RichTextEditor content={body} onChange={(html) => setBody(html)} />
          </div>

          <div>
            <div className="mb-2 text-sm text-slate-400">Signature</div>
            <textarea
              rows={5}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Best regards,\nMartin"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white outline-none"
            />
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-white/10 px-4 py-2 text-slate-300 hover:bg-white/20"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading
              ? 'Saving...'
              : isEditMode
              ? 'Save Changes'
              : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  )
}
