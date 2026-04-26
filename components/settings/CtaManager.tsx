'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calendar, Link2, Mail, Pencil, Plus, Power, Trash2, X } from 'lucide-react'

import type { UserCtaType } from '@/lib/agent/user-ctas'
import { isValidCtaValue, normalizeCtaValue } from '@/lib/agent/user-ctas'
import { supabase } from '@/lib/supabase'

type UserCtaRow = {
  id: string
  user_id: string
  label: string
  type: UserCtaType
  value: string | null
  is_active: boolean
  priority: number | null
  usage_count: number
  created_at: string
}

type CtaFormState = {
  id: string | null
  label: string
  type: UserCtaType
  value: string
  is_active: boolean
}

const CTA_TYPE_OPTIONS: Array<{ value: UserCtaType; label: string }> = [
  { value: 'link', label: 'Link' },
  { value: 'email', label: 'Email' },
  { value: 'calendly', label: 'Calendly' },
  { value: 'none', label: 'None' },
]

function emptyForm(): CtaFormState {
  return {
    id: null,
    label: '',
    type: 'link',
    value: '',
    is_active: true,
  }
}

function typeIcon(type: UserCtaType) {
  if (type === 'email') return <Mail className="h-3.5 w-3.5" />
  if (type === 'calendly') return <Calendar className="h-3.5 w-3.5" />
  if (type === 'none') return <Power className="h-3.5 w-3.5" />
  return <Link2 className="h-3.5 w-3.5" />
}

function valueLabel(type: UserCtaType) {
  if (type === 'email') return 'Email address'
  if (type === 'calendly') return 'Calendly URL'
  if (type === 'none') return 'Soft close'
  return 'Link URL'
}

export default function CtaManager({ userId }: { userId: string | null }) {
  const [ctas, setCtas] = useState<UserCtaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<CtaFormState>(emptyForm)

  useEffect(() => {
    if (!userId) {
      setCtas([])
      setLoading(false)
      return
    }
    void fetchCtas()
  }, [userId])

  const activeCount = useMemo(() => ctas.filter((cta) => cta.is_active).length, [ctas])

  async function fetchCtas() {
    if (!userId) return
    setLoading(true)

    const { data, error } = await supabase
      .from('user_ctas')
      .select('id, user_id, label, type, value, is_active, priority, usage_count, created_at')
      .eq('user_id', userId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[cta-manager] fetch failed:', error)
      setStatusMessage('Could not load CTAs.')
      setLoading(false)
      return
    }

    setCtas((data || []) as UserCtaRow[])
    setLoading(false)
  }

  function openCreateModal() {
    setForm(emptyForm())
    setModalOpen(true)
  }

  function openEditModal(cta: UserCtaRow) {
    setForm({
      id: cta.id,
      label: cta.label,
      type: cta.type,
      value: cta.value || '',
      is_active: cta.is_active,
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setForm(emptyForm())
  }

  async function saveCta() {
    if (!userId) return

    const label = form.label.trim()
    const normalizedValue = normalizeCtaValue(form.type, form.value)

    if (!label) {
      setStatusMessage('CTA label is required.')
      return
    }

    if (!isValidCtaValue(form.type, normalizedValue)) {
      setStatusMessage(form.type === 'none' ? 'CTA saved as a soft close.' : `Enter a valid ${valueLabel(form.type).toLowerCase()}.`)
      if (form.type !== 'none') return
    }

    setSaving(true)
    setStatusMessage('')

    const payload = {
      user_id: userId,
      label,
      type: form.type,
      value: normalizedValue,
      is_active: form.is_active,
    }

    const query = form.id
      ? supabase.from('user_ctas').update(payload).eq('id', form.id).eq('user_id', userId)
      : supabase.from('user_ctas').insert(payload)

    const { error } = await query

    if (error) {
      console.error('[cta-manager] save failed:', error)
      setStatusMessage('Could not save CTA.')
      setSaving(false)
      return
    }

    await fetchCtas()
    setSaving(false)
    closeModal()
    setStatusMessage(form.id ? 'CTA updated.' : 'CTA added.')
  }

  async function toggleActive(cta: UserCtaRow) {
    if (!userId) return

    const { error } = await supabase
      .from('user_ctas')
      .update({ is_active: !cta.is_active })
      .eq('id', cta.id)
      .eq('user_id', userId)

    if (error) {
      console.error('[cta-manager] toggle failed:', error)
      setStatusMessage('Could not update CTA status.')
      return
    }

    setCtas((prev) =>
      prev.map((item) => (item.id === cta.id ? { ...item, is_active: !item.is_active } : item))
    )
  }

  async function deleteCta(id: string) {
    if (!userId) return
    if (!window.confirm('Delete this CTA?')) return

    setDeletingId(id)
    const { error } = await supabase
      .from('user_ctas')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) {
      console.error('[cta-manager] delete failed:', error)
      setStatusMessage('Could not delete CTA.')
      setDeletingId(null)
      return
    }

    setCtas((prev) => prev.filter((cta) => cta.id !== id))
    setDeletingId(null)
    setStatusMessage('CTA deleted.')
  }

  return (
    <>
      <section className="glass p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">CTA Management</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Rotate multiple closing actions across your outreach. If none are active, drafts end with a natural soft close.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/16"
          >
            <Plus className="h-4 w-4" />
            Add CTA
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Total CTAs</div>
            <div className="mt-3 text-lg font-semibold text-white">{ctas.length}</div>
          </div>
          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Active</div>
            <div className="mt-3 text-lg font-semibold text-white">{activeCount}</div>
          </div>
          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Rotation</div>
            <div className="mt-3 text-lg font-semibold text-white">{activeCount > 1 ? 'Live' : 'Single CTA'}</div>
          </div>
        </div>

        {statusMessage ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            {statusMessage}
          </div>
        ) : null}

        <div className="mt-5 space-y-3">
          {loading ? (
            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              Loading CTAs...
            </div>
          ) : ctas.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-white/12 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No CTAs yet. Generated drafts will simply end naturally until you add one.
            </div>
          ) : (
            ctas.map((cta) => (
              <div
                key={cta.id}
                className="flex flex-col gap-4 rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
                      {typeIcon(cta.type)}
                      {cta.label}
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        cta.is_active
                          ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                          : 'border border-white/10 bg-white/[0.04] text-slate-500'
                      }`}
                    >
                      {cta.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-400">
                    {cta.value || 'Soft close without a link'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleActive(cta)}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                      cta.is_active
                        ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300 hover:text-white'
                        : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
                    }`}
                  >
                    {cta.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(cta)}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === cta.id}
                    onClick={() => void deleteCta(cta.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-300/14 bg-rose-400/10 px-3 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-400/16 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#081120] shadow-[0_24px_80px_rgba(2,8,23,0.45)]">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-white">
                  {form.id ? 'Edit CTA' : 'Add CTA'}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Keep it lightweight. ALPA rotates active CTAs across drafts.
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Label</span>
                <input
                  value={form.label}
                  onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                  placeholder="Book a call"
                  className="input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-slate-300">Type</span>
                <select
                  value={form.type}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      type: event.target.value as UserCtaType,
                      value: event.target.value === 'none' ? '' : prev.value,
                    }))
                  }
                  className="input"
                >
                  {CTA_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {form.type !== 'none' ? (
                <label className="space-y-2">
                  <span className="text-sm text-slate-300">{valueLabel(form.type)}</span>
                  <input
                    value={form.value}
                    onChange={(event) => setForm((prev) => ({ ...prev, value: event.target.value }))}
                    placeholder={
                      form.type === 'email'
                        ? 'you@example.com'
                        : form.type === 'calendly'
                        ? 'https://calendly.com/your-handle'
                        : 'https://your-site.com'
                    }
                    className="input"
                  />
                </label>
              ) : (
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                  This CTA will end with a soft close and no link.
                </div>
              )}

              <label className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-white">Active</div>
                  <div className="mt-1 text-xs text-slate-500">Only active CTAs participate in rotation.</div>
                </div>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                  className="h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-emerald-500"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-white/8 px-5 py-4">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveCta()}
                disabled={saving}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                {saving ? 'Saving...' : form.id ? 'Save CTA' : 'Add CTA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
