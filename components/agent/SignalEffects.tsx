'use client'

import { useEffect, useRef, useState } from 'react'

type LogEntry = {
  id: string
  text: string
  x: number  // px offset from container center
  y: number
}

type PulseRing = {
  id: string
  x: number
  y: number
}

type Props = {
  active: boolean
  locationHint?: string | null
}

const LOG_POOL = [
  'Lead found',
  'Contact verified',
  'Draft created',
  'Enriching profile…',
  'Email queued',
  'Source scanned',
  'Match qualified',
]

function randomOffset(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function SignalEffects({ active, locationHint }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pulses, setPulses] = useState<PulseRing[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) return

    function schedule() {
      // Random interval 2.8–5.5s
      const wait = 2800 + Math.random() * 2700
      timerRef.current = setTimeout(() => {
        const base = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)]
        const text = locationHint && Math.random() > 0.5 ? `${base} · ${locationHint}` : base

        // Position: ring around core (radius ~100–160px), random angle
        const angle = Math.random() * Math.PI * 2
        const r = randomOffset(90, 155)
        const x = Math.cos(angle) * r
        const y = Math.sin(angle) * r

        const id = Math.random().toString(36).slice(2, 9)

        setLogs((prev) => [...prev.slice(-4), { id, text, x, y }])

        // Occasionally emit a pulse ring from core center
        if (Math.random() > 0.5) {
          const pid = `p-${id}`
          setPulses((prev) => [...prev.slice(-2), { id: pid, x: 0, y: 0 }])
          setTimeout(() => setPulses((prev) => prev.filter((p) => p.id !== pid)), 1500)
        }

        // Remove log after animation completes
        setTimeout(() => setLogs((prev) => prev.filter((l) => l.id !== id)), 2700)

        schedule()
      }, wait)
    }

    schedule()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [active, locationHint])

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Pulse rings from core center */}
      {pulses.map((p) => (
        <div
          key={p.id}
          className="ai-pulse-ring absolute rounded-full"
          style={{
            top: '50%',
            left: '50%',
            width: 60,
            height: 60,
            marginLeft: -30,
            marginTop: -30,
            border: '1px solid rgba(59,130,246,0.35)',
          }}
        />
      ))}

      {/* Floating log text */}
      {logs.map((log) => (
        <div
          key={log.id}
          className="absolute"
          style={{
            top: `calc(50% + ${log.y}px)`,
            left: `calc(50% + ${log.x}px)`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <span className="ai-log-rise block whitespace-nowrap text-[10px] text-white/35">
            {log.text}
          </span>
        </div>
      ))}
    </div>
  )
}
