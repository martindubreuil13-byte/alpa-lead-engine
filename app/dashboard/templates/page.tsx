'use client'

import { useEffect, useMemo, useState } from 'react'

import FeatureLockNotice from '@/components/access/FeatureLockNotice'
import { canAccessFeature } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { buildTemplateBodyHtml } from '@/lib/email/signature'
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

type ComposerView = 'editor' | 'preview'

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
  const [composerView, setComposerView] = useState<ComposerView>('editor')
  const templatesLocked = !profileLoading && !canAccessFeature('templates', profile)

  useEffect(() => {
    void fetchTemplates()
  }, [])

  const previewHtml = useMemo(() => buildTemplateBodyHtml(form.body), [form.body])

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
    setComposerView('editor')
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
    setComposerView('editor')
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
    <div className="space-y-6 pb-4">
      <header className="glass p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100/70">
              Template system
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Templates
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Write outreach once, preview it comfortably on mobile, and keep your best sequences ready for the inbox or pipeline.
            </p>
          </div>

          <button
            type="button"
            onClick={startCreate}
            className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]"
          >
            New template
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatCard label="Saved templates" value={templates.length} />
          <StatCard label="Current mode" value={editingTemplateId ? 'Editing' : 'Creating'} />
          <StatCard label="Preview ready" value={form.body.trim() ? 'Yes' : 'No'} />
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-4">
          <section className="glass p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  {editingTemplateId ? 'Edit template' : 'Create template'}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Keep the form single-column on mobile, then switch to preview when you want to review it.
                </p>
              </div>

              <div className="inline-flex rounded-2xl border border-white/10 bg-[#081120]/80 p-1">
                {(['editor', 'preview'] as ComposerView[]).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => setComposerView(view)}
                    className={`min-h-[40px] rounded-xl px-4 text-sm font-medium transition ${
                      composerView === view
                        ? 'bg-emerald-400/12 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {view === 'editor' ? 'Editor' : 'Preview'}
                  </button>
                ))}
              </div>
            </div>

            {composerView === 'editor' ? (
              <div className="mt-6 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Template name</span>
                    <input
                      value={form.name}
                      onChange={(event) => updateField('name', event.target.value)}
                      placeholder="FR Follow-up"
                      className="input"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">Type / tag</span>
                    <input
                      value={form.tag}
                      onChange={(event) => updateField('tag', event.target.value)}
                      placeholder="Follow-up"
                      className="input"
                    />
                  </label>
                </div>

                <label className="space-y-2">
                  <span className="text-sm text-slate-300">Subject</span>
                  <input
                    value={form.subject}
                    onChange={(event) => updateField('subject', event.target.value)}
                    placeholder="Quick question about your business"
                    className="input"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm text-slate-300">Body</span>
                  <textarea
                    rows={14}
                    value={form.body}
                    onChange={(event) => updateField('body', event.target.value)}
                    placeholder={`Hi there,\n\nI wanted to reach out because...`}
                    className="input min-h-[340px] resize-y leading-7"
                  />
                </label>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Subject</div>
                  <div className="mt-3 text-base font-medium text-white">
                    {form.subject.trim() || 'Your subject will appear here'}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/8 bg-[#081120]/80 p-4">
                  <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Mobile preview
                  </div>
                  <div className="rounded-[24px] bg-white p-5 text-sm leading-7 text-slate-800 shadow-[0_20px_45px_rgba(15,23,42,0.2)]">
                    {previewHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    ) : (
                      <div className="italic text-slate-400">
                        Start typing your message in the editor to preview it here.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 xl:bottom-6">
            <div className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">
                  {editingTemplateId ? 'Ready to update this template' : 'Ready to save a new template'}
                </div>
                {statusMessage ? (
                  <p className="mt-1 text-sm text-slate-300">{statusMessage}</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Save from here and keep the action button reachable while you type.
                  </p>
                )}
              </div>

              <button type="button" onClick={saveTemplate} disabled={saving} className="btn-primary w-full sm:w-auto">
                {saving ? 'Saving...' : editingTemplateId ? 'Save changes' : 'Save template'}
              </button>
            </div>
          </div>
        </div>

        <section className="glass p-5 sm:p-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-white">Saved templates</h2>
            <p className="text-sm text-slate-400">
              Reopen any saved template to edit it, or remove templates you no longer need.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            {loading ? (
              <p className="text-slate-400">Loading templates...</p>
            ) : templates.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
                No templates saved yet.
              </div>
            ) : (
              templates.map((template) => (
                <article
                  key={template.id}
                  className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-white">
                        {template.name}
                      </h3>
                      {template.tag ? (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] uppercase tracking-wide text-emerald-300">
                          {template.tag}
                        </span>
                      ) : null}
                    </div>

                    <p className="text-sm text-slate-300">{template.subject}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(template.created_at).toLocaleString()}
                    </p>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => startEdit(template)}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteTemplate(template.id)}
                        disabled={deletingId === template.id}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-rose-300/14 bg-rose-400/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-400/16 disabled:opacity-60"
                      >
                        {deletingId === template.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-3 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}
