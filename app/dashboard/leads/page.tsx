'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  industry: string
  city: string
  status: string
  email: string | null
  phone: string | null
}

export default function Page() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    const { data, error } = await supabase
      .from('leads')
      .select('id, company_name, industry, city, status, email, phone')
      .order('created_at', { ascending: false })

    if (!error && data) setLeads(data)
    setLoading(false)
  }

  async function deleteLead(id: string) {
    if (!confirm('Delete this lead?')) return
    await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  function readiness(lead: Lead) {
    if (lead.email) return 'ready'
    if (!lead.email && (lead.phone || lead.company_name)) return 'enrich'
    return 'poor'
  }

  function ReadinessBadge({ type }: { type: string }) {
    const styles: any = {
      ready: 'bg-emerald-400/10 text-emerald-300',
      enrich: 'bg-amber-400/10 text-amber-300',
      poor: 'bg-rose-400/10 text-rose-300'
    }

    const labels: any = {
      ready: 'Ready',
      enrich: 'Needs Email',
      poor: 'Low Quality'
    }

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${styles[type]}`}>
        {labels[type]}
      </span>
    )
  }

  return (
    <div className="space-y-10">

      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">Leads</h1>
        <p className="text-slate-400 mt-2">Outreach-ready prospect database</p>
      </div>

      <div className="glass overflow-hidden">
        <table className="w-full text-xs table-fixed">
          <thead className="bg-white/5 text-slate-400">
            <tr>
              <th className="p-4 text-left w-[30%]">Company</th>
              <th className="p-4 text-left w-[14%]">City</th>
              <th className="p-4 text-left w-[22%]">Email</th>
              <th className="p-4 text-left w-[14%]">Phone</th>
              <th className="p-4 text-left w-[12%]">Readiness</th>
              <th className="p-4 text-right w-[8%]">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  Loading leads...
                </td>
              </tr>
            )}

            {!loading && leads.map((lead) => (
              <tr
                key={lead.id}
                className="border-t border-white/5 hover:bg-white/5 transition"
              >
                <td className="p-4 font-medium text-white truncate whitespace-nowrap">
                  {lead.company_name}
                </td>

                <td className="p-4 text-slate-300 whitespace-nowrap">
                  {lead.city || '—'}
                </td>

                <td className="p-4 text-slate-300 truncate whitespace-nowrap">
                  {lead.email || '—'}
                </td>

                <td className="p-4 text-slate-300 whitespace-nowrap">
                  {lead.phone || '—'}
                </td>

                <td className="p-4 whitespace-nowrap">
                  <ReadinessBadge type={readiness(lead)} />
                </td>

                <td className="p-4 text-right whitespace-nowrap">
                  <div className="flex justify-end gap-4">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="text-slate-400 hover:text-white transition"
                    >
                      Open
                    </Link>

                    <button
                      onClick={() => deleteLead(lead.id)}
                      className="text-rose-400 hover:text-rose-300 transition"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>

        </table>
      </div>
    </div>
  )
}