'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type LogEntry = {
  id: string
  text: string
  x: number
  y: number
}

type PulseRing = {
  id: string
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

// Static ambient particles — generated once, drifting slowly
const PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  // angle in radians, radius fraction (0–1 of container)
  angle: (i / 10) * Math.PI * 2 + Math.random() * 0.6,
  r: 0.22 + Math.random() * 0.30,   // 22–52% of half-container
  size: 1 + Math.random() * 1.5,    // 1–2.5px
  delay: Math.random() * -8,        // stagger drift animation
  duration: 6 + Math.random() * 8,  // 6–14s per cycle
  opacity: 0.08 + Math.random() * 0.12, // very faint
}))

function randomOffset(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function SignalEffects({ active, locationHint }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pulses, setPulses] = useState<PulseRing[]>([])
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Memoize particle layout so it doesn't re-randomize on re-render
  const particles = useMemo(() => PARTICLES, [])

  useEffect(() => {
    if (!active) return

    function schedulePulse() {
      const wait = 4000 + Math.random() * 2000
      pulseTimerRef.current = setTimeout(() => {
        const pid = Math.random().toString(36).slice(2, 9)
        setPulses((prev) => [...prev.slice(-2), { id: pid }])
        setTimeout(() => setPulses((prev) => prev.filter((p) => p.id !== pid)), 1800)
        schedulePulse()
      }, wait)
    }

    function scheduleLog() {
      // Rare whispers: 9–18s between appearances
      const wait = 9000 + Math.random() * 9000
      logTimerRef.current = setTimeout(() => {
        const base = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)]
        const text = locationHint && Math.random() > 0.55 ? `${base} · ${locationHint}` : base

        // Position in a gentle ring around core (radius 120–180px)
        const angle = Math.random() * Math.PI * 2
        const r = randomOffset(120, 180)
        const x = Math.cos(angle) * r
        const y = Math.sin(angle) * r

        const id = Math.random().toString(36).slice(2, 9)
        setLogs((prev) => [...prev.slice(-3), { id, text, x, y }])
        setTimeout(() => setLogs((prev) => prev.filter((l) => l.id !== id)), 2800)

        scheduleLog()
      }, wait)
    }

    schedulePulse()
    scheduleLog()

    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
      if (logTimerRef.current) clearTimeout(logTimerRef.current)
    }
  }, [active, locationHint])

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* ── Ambient particles ────────────────────────────────────────────── */}
      {particles.map((p) => {
        // Convert polar to CSS % positions
        const px = 50 + Math.cos(p.angle) * p.r * 50
        const py = 50 + Math.sin(p.angle) * p.r * 50
        return (
          <div
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: `${px}%`,
              top: `${py}%`,
              width: p.size,
              height: p.size,
              background: 'rgba(96,165,250,1)',
              opacity: active ? p.opacity : p.opacity * 0.4,
              animationName: 'ai-node-float',
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: 'infinite',
              transition: 'opacity 1.5s ease',
            }}
          />
        )
      })}

      {/* ── Pulse rings from core center ─────────────────────────────────── */}
      {pulses.map((p) => (
        <div
          key={p.id}
          className="ai-pulse-ring absolute rounded-full"
          style={{
            top: '50%',
            left: '50%',
            width: 72,
            height: 72,
            marginLeft: -36,
            marginTop: -36,
            border: '1px solid rgba(59,130,246,0.28)',
          }}
        />
      ))}

      {/* ── Floating log whispers ─────────────────────────────────────────── */}
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
          <span className="ai-log-rise block whitespace-nowrap text-[10px] text-white/30">
            {log.text}
          </span>
        </div>
      ))}
    </div>
  )
}
