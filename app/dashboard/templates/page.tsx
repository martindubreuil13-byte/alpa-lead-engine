'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AddTemplateModal from '@/components/templates/AddTemplateModal'

type Template = {
  id: string
  name: string
  subject: string
  body: string
  description: string | null
  is_active: boolean
  category: string
}

const categoryStyles: Record<string, string> = {
  first_prospecting: 'bg-blue-500/15 text-blue-300 border-blue-400/30',
  follow_up: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  reactivation: 'bg-purple-500/15 text-purple-300 border-purple-400/30',
  general: 'bg-white/10 text-gray-300 border-white/15',
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)

  useEffect(() => {
    fetchTemplates()
  }, [])

  async function fetchTemplates() {
    setLoading(true)

    const { data, error } = await supabase
      .from('email_templates')
      .select('id, name, subject, body, description, is_active, category')
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
    } else if (data) {
      setTemplates(data)
    }

    setLoading(false)
  }

  async function deleteTemplate(id: string) {
    const confirmed = confirm('Delete this template permanently?')
    if (!confirmed) return

    const { error } = await supabase
      .from('email_templates')
      .delete()
      .eq('id', id)

    if (error) {
      alert('Error deleting template')
      return
    }

    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  function handleCloseModal() {
    setIsModalOpen(false)
    setEditingTemplate(null)
  }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-white">
        
        {/* Header */}
        <div className="border-b border-white/10 bg-white/5 px-10 pt-12 pb-8 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div>
              <h1 className="mb-2 text-4xl font-semibold tracking-tight">
                Email Templates
              </h1>
              <p className="text-sm text-gray-400">
                Manage prospecting messaging and campaign structures
              </p>
            </div>

            <button
              className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 font-medium tracking-wide shadow-2xl shadow-blue-900/30 transition hover:opacity-90"
              onClick={() => {
                setEditingTemplate(null)
                setIsModalOpen(true)
              }}
            >
              + Add Template
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-6xl px-10 py-12">
          {loading ? (
            <p className="text-gray-400">Loading templates...</p>
          ) : templates.length === 0 ? (
            <p className="text-gray-500">No templates yet.</p>
          ) : (
            <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-3">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.07] p-7 shadow-xl shadow-black/40 backdrop-blur-2xl transition-all duration-300 hover:border-white/20 hover:shadow-2xl hover:shadow-blue-900/20"
                >
                  {/* Top Row */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <h2 className="text-xl font-semibold leading-snug pr-4">
                      {t.name}
                    </h2>

                    <span
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium tracking-wide ${
                        categoryStyles[t.category] || categoryStyles.general
                      }`}
                    >
                      {t.category.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Subject */}
                  <p className="mb-5 text-sm text-gray-400">
                    {t.subject}
                  </p>

                  {/* Description */}
                  {t.description && (
                    <p className="mb-6 text-sm leading-relaxed text-gray-500">
                      {t.description}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
                    <span
                      className={`rounded-full px-3 py-1 text-xs ${
                        t.is_active
                          ? 'border border-emerald-400/20 bg-emerald-500/15 text-emerald-300'
                          : 'border border-gray-400/20 bg-gray-500/15 text-gray-400'
                      }`}
                    >
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>

                    <div className="flex gap-3">
                      <button
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
                        onClick={() => {
                          setEditingTemplate(t)
                          setIsModalOpen(false)
                        }}
                      >
                        ✏️ Edit
                      </button>

                      <button
                        className="rounded-lg bg-red-500/20 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/30"
                        onClick={() => deleteTemplate(t.id)}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AddTemplateModal
        isOpen={isModalOpen || !!editingTemplate}
        onClose={handleCloseModal}
        onCreated={fetchTemplates}
        editTemplate={editingTemplate}
      />
    </>
  )
}