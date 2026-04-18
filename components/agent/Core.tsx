'use client'

import { memo, useEffect, useRef } from 'react'

export type CoreStatus = 'running' | 'paused' | 'idle'

type Props = {
  /** Pixel diameter of the core sphere. */
  size: number
  /** Real computed label — no fake rotation, caller drives this. */
  label: string
  /** Increment to fire a single event pulse (lead_found, etc.). */
  pulseKey: number
}

export const Core = memo(function Core({ size, label, pulseKey }: Props) {
  const pulseRef = useRef<HTMLDivElement>(null)

  // Imperative pulse: triggers only when pulseKey increments.
  // Resets animation so it always replays from 0.
  useEffect(() => {
    if (pulseKey === 0) return
    const el = pulseRef.current
    if (!el) return
    el.style.animation = 'none'
    // Force reflow to restart the animation
    void el.offsetHeight
    el.style.animation = 'ai-edge-pulse 0.4s ease-out forwards'
  }, [pulseKey])

  const glowSize = size + 160
  const ring1 = size * 1.38
  const ring2 = size * 1.76

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* ── Layer 1: Static base glow — no animation, GPU composite only ──── */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: glowSize,
          height: glowSize,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle, rgba(59,130,246,0.09) 0%, rgba(59,130,246,0.02) 52%, transparent 72%)',
          filter: 'blur(26px)',
        }}
      />

      {/* ── Layer 2: Slow breathing glow — CSS keyframe, opacity only ──────── */}
      <div
        className="ai-core-glow pointer-events-none absolute rounded-full"
        style={{
          width: size * 1.18,
          height: size * 1.18,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 68%)',
          filter: 'blur(18px)',
        }}
      />

      {/* ── Concentric trace rings (static) ─────────────────────────────────── */}
      {[ring1, ring2].map((d, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-full"
          style={{
            width: d,
            height: d,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            border: `1px solid rgba(59,130,246,${i === 0 ? '0.07' : '0.035'})`,
          }}
        />
      ))}

      {/* ── Core sphere — CSS breathe animation ─────────────────────────────── */}
      <div
        className="ai-core-breathe relative flex items-center justify-center overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle at 38% 32%,
            rgba(255,255,255,0.12) 0%,
            rgba(96,165,250,0.22) 16%,
            rgba(59,130,246,0.16) 32%,
            rgba(15,23,42,0.92) 58%,
            rgba(2,6,23,0.98) 100%)`,
          border: '1px solid rgba(59,130,246,0.14)',
          boxShadow:
            '0 0 32px 4px rgba(59,130,246,0.06), inset 0 0 48px rgba(59,130,246,0.05)',
        }}
      >
        {/* Nucleus */}
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: '20%',
            height: '20%',
            background:
              'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(147,197,253,0.12) 55%, transparent 80%)',
            filter: 'blur(3px)',
          }}
        />
        {/* Top-left specular */}
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: '44%',
            height: '32%',
            top: '10%',
            left: '16%',
            background:
              'radial-gradient(ellipse, rgba(255,255,255,0.06) 0%, transparent 70%)',
          }}
        />

        {/* Real status label — driven by caller, no fake rotation */}
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.20em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.28)',
            userSelect: 'none',
            textAlign: 'center',
            padding: '0 14px',
            lineHeight: 1.4,
          }}
        >
          {label}
        </span>
      </div>

      {/* ── Layer 3: Event pulse overlay — fired imperatively, GPU-only ──────── */}
      <div
        ref={pulseRef}
        className="pointer-events-none absolute rounded-full"
        style={{
          width: size,
          height: size,
          top: '50%',
          left: '50%',
          // transform in ai-edge-pulse already handles centering
          border: '2px solid rgba(96,165,250,0.55)',
          opacity: 0,
        }}
      />
    </div>
  )
})
