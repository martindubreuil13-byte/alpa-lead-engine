'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type MissionBuilderProps = {
  icpId: string
  embedded?: boolean
}

export default function MissionBuilder({ icpId, embedded = false }: MissionBuilderProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [leadsPerDay, setLeadsPerDay] = useState(10)
  const [contactMode, setContactMode] = useState<'email' | 'phone' | 'either'>('email')
  const [location, setLocation] = useState('Global')
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setSuccessMessage(null)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/agent/missions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          icp_id: icpId,
          name,
          leads_per_day: leadsPerDay,
          contact_mode: contactMode,
          location,
          require_email: true,
          require_phone: contactMode !== 'email',
          require_website: true,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create mission')
      }

      setSuccessMessage('Mission created and ready')
      setName('')
      setLeadsPerDay(10)
      setContactMode('email')
      setLocation('Global')
      router.refresh()
    } catch (error) {
      console.error(error)
      setErrorMessage('Failed to create mission')
    } finally {
      setLoading(false)
    }
  }

  const content = (
    <>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
          Mission Builder
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Launch Mission
        </h2>
        <p className="text-sm leading-6 text-slate-400">
          Define what the agent should do daily.
        </p>
        <p className="text-sm leading-6 text-slate-400">
          Email is currently supported. Phone support coming soon.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-200">Mission name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Agency outbound sprint"
            className="input min-h-[52px] rounded-2xl bg-[#06101f]/90 px-4 text-sm text-white"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-200">Leads per day</span>
          <input
            type="number"
            min={1}
            value={leadsPerDay}
            onChange={(event) => setLeadsPerDay(Number(event.target.value) || 10)}
            className="input min-h-[52px] rounded-2xl bg-[#06101f]/90 px-4 text-sm text-white"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-200">Contact mode</span>
          <select
            value={contactMode}
            onChange={(event) => setContactMode(event.target.value as 'email' | 'phone' | 'either')}
            className="input min-h-[52px] rounded-2xl bg-[#06101f]/90 px-4 text-sm text-white"
          >
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="either">Either</option>
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-200">Location</span>
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Global"
            className="input min-h-[52px] rounded-2xl bg-[#06101f]/90 px-4 text-sm text-white"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className={`btn-primary min-h-[52px] w-full rounded-2xl ${
            loading ? 'cursor-not-allowed opacity-70' : ''
          }`}
        >
          {loading ? 'Creating mission...' : 'Create mission'}
        </button>

        {successMessage ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {successMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {errorMessage}
          </div>
        ) : null}
      </form>
    </>
  )

  if (embedded) {
    return <div className="space-y-4">{content}</div>
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.82),rgba(5,10,18,0.94))] p-4 shadow-[0_18px_40px_rgba(2,8,23,0.18)] sm:p-6">
      <div className="space-y-4">{content}</div>
    </section>
  )
}
