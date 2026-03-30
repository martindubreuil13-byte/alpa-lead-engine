'use client'

import { useEffect, useState } from 'react'

import FeatureLockNotice from '@/components/access/FeatureLockNotice'
import { canAccessFeature } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { supabase } from '@/lib/supabase'

type TemplateRow = {
  id: string
  user_id: string
  name: string
  tag: string | null
  subject: string
  body: string
  created_at: string
}

function emptyForm() {
  return {
    name: '',
    tag: '',
    subject: '',
    body: '',
  }
}

export default function TemplatesPage() {
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const templatesLocked = !profileLoading && !canAccessFeature('templates', profile)

  useEffect(() => {
    fetchTemplates()
  }, [])

  async function fetchTemplates() {
    setLoading(true)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      console.error('Unable to resolve authenticated user:', userError)
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('templates')
      .select('id, user_id, name, tag, subject, body, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('FULL ERROR:', JSON.stringify(error, null, 2))
      setLoading(false)
      return
    }

    setTemplates((data as TemplateRow[]) || [])
    setLoading(false)
  }

  function updateField(field: keyof ReturnType<typeof emptyForm>, value: string) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  function startCreate() {
    setEditingTemplateId(null)
    setForm(emptyForm())
    setStatusMessage('')
  }

  function startEdit(template: TemplateRow) {
    setEditingTemplateId(template.id)
    setForm({
      name: template.name,
      tag: template.tag || '',
      subject: template.subject,
      body: template.body,
    })
    setStatusMessage('')
  }

  async function saveTemplate() {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      setStatusMessage('Template name, subject, and body are required.')
      return
    }

    setSaving(true)
    setStatusMessage('')

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      setSaving(false)
      setStatusMessage('You must be logged in to save templates.')
      return
    }

    if (editingTemplateId) {
      const { error } = await supabase
        .from('templates')
        .update({
          name: form.name.trim(),
          tag: form.tag.trim() || null,
          subject: form.subject.trim(),
          body: form.body.trim(),
        })
        .eq('id', editingTemplateId)
        .eq('user_id', user.id)

      setSaving(false)

      if (error) {
        console.error('FULL ERROR:', JSON.stringify(error, null, 2))
        setStatusMessage('Unable to update template.')
        return
      }

      console.log('Template updated')
      setStatusMessage('Template updated successfully.')
      await fetchTemplates()
      return
    }

    const { error } = await supabase.from('templates').insert({
      user_id: user.id,
      name: form.name.trim(),
      tag: form.tag.trim() || null,
      subject: form.subject.trim(),
      body: form.body.trim(),
      created_at: new Date().toISOString(),
    })

    setSaving(false)

    if (error) {
      console.error('FULL ERROR:', JSON.stringify(error, null, 2))
      setStatusMessage('Unable to save template.')
      return
    }

    console.log('Template saved')
    setStatusMessage('Template saved successfully.')
    setForm(emptyForm())
    await fetchTemplates()
  }

  async function deleteTemplate(id: string) {
    setDeletingId(id)
    setStatusMessage('')

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      setDeletingId(null)
      setStatusMessage('You must be logged in to delete templates.')
      return
    }

    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    setDeletingId(null)

    if (error) {
      console.error('FULL ERROR:', JSON.stringify(error, null, 2))
      setStatusMessage('Unable to delete template.')
      return
    }

    if (editingTemplateId === id) {
      setEditingTemplateId(null)
      setForm(emptyForm())
    }

    setStatusMessage('Template deleted successfully.')
    await fetchTemplates()
  }

  if (profileLoading) {
    return <div className="text-slate-400">Loading templates...</div>
  }

  if (templatesLocked) {
    return (
      <FeatureLockNotice
        title="Templates are available on Starter"
        description="Save reusable outreach templates and unlock faster sending when you upgrade to Starter."
      />
    )
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-white">Templates</h1>
        <p className="text-slate-400">
          Create reusable templates for first-touch outreach, follow-ups, and language-specific campaigns.
        </p>
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="glass rounded-3xl p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {editingTemplateId ? 'Edit Template' : 'Create Template'}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Save as many templates as you need and choose the right one when sending.
              </p>
            </div>

            {editingTemplateId && (
              <button
                onClick={startCreate}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/20"
              >
                New Template
              </button>
            )}
          </div>

          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Template name</span>
                <input
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="FR Follow-up"
                  className="input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-slate-300">Type / tag</span>
                <input
                  value={form.tag}
                  onChange={(e) => updateField('tag', e.target.value)}
                  placeholder="Follow-up"
                  className="input"
                />
              </label>
            </div>

            <label className="space-y-2">
              <span className="text-sm text-slate-300">Subject</span>
              <input
                value={form.subject}
                onChange={(e) => updateField('subject', e.target.value)}
                placeholder="Quick question about your business"
                className="input"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-slate-300">Body</span>
              <textarea
                rows={14}
                value={form.body}
                onChange={(e) => updateField('body', e.target.value)}
                placeholder={`Hi there,\n\nI wanted to reach out because...`}
                className="input min-h-[320px] resize-y leading-7"
              />
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={saveTemplate}
                disabled={saving}
                className="rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingTemplateId ? 'Save Changes' : 'Save Template'}
              </button>

              {statusMessage && (
                <p className="text-sm text-slate-300">{statusMessage}</p>
              )}
            </div>
          </div>
        </section>

        <section className="glass rounded-3xl p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white">Saved Templates</h2>
            <p className="mt-1 text-sm text-slate-400">
              Reopen any saved template to edit it or delete templates you no longer need.
            </p>
          </div>

          {loading ? (
            <p className="text-slate-400">Loading templates...</p>
          ) : templates.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-slate-300">
              No templates saved yet.
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <article
                  key={template.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-white">
                          {template.name}
                        </h3>
                        {template.tag && (
                          <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] uppercase tracking-wide text-cyan-300">
                            {template.tag}
                          </span>
                        )}
                      </div>

                      <p className="mt-2 truncate text-sm text-slate-300">
                        {template.subject}
                      </p>

                      <p className="mt-2 text-xs text-slate-500">
                        {new Date(template.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => startEdit(template)}
                        className="rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/20"
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => deleteTemplate(template.id)}
                        disabled={deletingId === template.id}
                        className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/25 disabled:opacity-50"
                      >
                        {deletingId === template.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
