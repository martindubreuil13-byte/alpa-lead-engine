'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

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
  const [category, setCategory] = useState('first_outreach')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (editTemplate) {
      setName(editTemplate.name)
      setSubject(editTemplate.subject)
      setBody(editTemplate.body)
      setDescription(editTemplate.description || '')
      setCategory(editTemplate.category)
    }
  }, [editTemplate])

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl p-8 shadow-2xl">
        <h2 className="text-2xl font-semibold mb-6">
          {isEditMode ? 'Edit Email Template' : 'Create Email Template'}
        </h2>

        <div className="grid gap-4">
          <input
            placeholder="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-3"
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-3"
          >
            <option value="first_outreach">First Outreach</option>
            <option value="follow_up">Follow-up</option>
            <option value="reactivation">Reactivation</option>
            <option value="general">General</option>
          </select>

          <input
            placeholder="Email subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-3"
          />

          <textarea
            placeholder="Email body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-3"
          />

          <textarea
            placeholder="Internal description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-3"
          />
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700"
          >
            {loading ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}