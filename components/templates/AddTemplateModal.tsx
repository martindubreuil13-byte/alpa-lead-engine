'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import RichTextEditor from '@/components/editor/RichTextEditor'

type Template = {
  id: string
  name: string
  subject: string
  body: string
  description: string | null
  category: string
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
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('first_prospecting')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (editTemplate) {
      setName(editTemplate.name)
      setSubject(editTemplate.subject)
      setBody(editTemplate.body)
      setDescription(editTemplate.description || '')
      setCategory(editTemplate.category)
    } else {
      setName('')
      setSubject('')
      setBody('')
      setDescription('')
      setCategory('first_prospecting')
    }
  }, [editTemplate, isOpen])

  if (!isOpen) return null

  async function handleSave() {
    if (!name || !subject || !body) {
      alert('Name, subject and body are required')
      return
    }

    setLoading(true)

    if (isEditMode) {
      await supabase
        .from('email_templates')
        .update({ name, subject, body, description, category })
        .eq('id', editTemplate!.id)
    } else {
      const slug = name.toLowerCase().replace(/\s+/g, '-')

      await supabase.from('email_templates').insert({
        name,
        subject,
        body,
        description,
        slug,
        category,
        is_active: true,
      })
    }

    setLoading(false)
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

          {/* Name */}
          <input
            placeholder="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
          />

          {/* Category */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
          >
            <option value="first_prospecting">First Prospecting</option>
            <option value="follow_up">Follow-up</option>
            <option value="reactivation">Reactivation</option>
            <option value="general">General</option>
          </select>

          {/* Subject */}
          <input
            placeholder="Email subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
          />

          {/* Rich Text Body */}
          <div>
            <div className="mb-2 text-sm text-slate-400">Email Body</div>
            <RichTextEditor
              content={body}
              onChange={(html) => setBody(html)}
            />
          </div>

          {/* Description */}
          <textarea
            placeholder="Internal description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white"
          />
        </div>

        {/* Actions */}
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