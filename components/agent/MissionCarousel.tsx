'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import { MissionCard, type MissionCardData } from './MissionCard'

// ─── Layout constants ─────────────────────────────────────────────────────────

const CARD_W = 210
const GAP = 12
const CARD_STRIDE = CARD_W + GAP   // 222 px per slot
const SCROLL_PX = 0.38             // px moved per animation frame (~23 px/s at 60fps)

// Threshold above which virtual rendering is used (items not in view are skipped)
const VIRTUAL_THRESHOLD = 20

// Buffer: extra items to render on each side of the visible window
const VIRTUAL_BUFFER = 3

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  missions: MissionCardData[]
  onCardClick: (id: string) => void
  onNewMission: () => void
  highlightedMissionId?: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MissionCarousel = memo(function MissionCarousel({
  missions,
  onCardClick,
  onNewMission,
  highlightedMissionId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const offsetRef = useRef(0)
  const rafRef = useRef<number>(0)
  const pausedRef = useRef(false)   // hover / touch pause — avoids state update in RAF

  // For large lists: virtual start index (React state — updates rarely, ~every 10s of scroll)
  const [virtualStart, setVirtualStart] = useState(0)
  const lastVirtualStartRef = useRef(-1)

  const isVirtual = missions.length > VIRTUAL_THRESHOLD

  // Width of one logical copy of the mission list
  const loopWidth = missions.length * CARD_STRIDE

  // Visible missions (duplicated for seamless looping when ≤ threshold)
  // For virtual mode we render a window of indices; for standard mode we duplicate.
  const displayMissions: MissionCardData[] = isVirtual
    ? missions
    : [...missions, ...missions]

  // ── Container width via ResizeObserver (used for virtual window size) ──────
  const [containerWidth, setContainerWidth] = useState(800)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerWidth(el.offsetWidth))
    ro.observe(el)
    setContainerWidth(el.offsetWidth)
    return () => ro.disconnect()
  }, [])

  const visibleCount = Math.ceil(containerWidth / CARD_STRIDE) + 1

  // ── RAF auto-scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    if (missions.length === 0) return

    function tick() {
      if (!pausedRef.current) {
        offsetRef.current -= SCROLL_PX

        // Seamless loop: once we've scrolled past one full copy, snap back silently
        if (-offsetRef.current >= loopWidth) {
          offsetRef.current = 0
        }

        // Apply transform directly — no React state, no re-render
        if (trackRef.current) {
          trackRef.current.style.transform = `translateX(${offsetRef.current}px)`
        }

        // Virtual window: only update React state when the window actually shifts
        if (isVirtual) {
          const rawStart = Math.floor(-offsetRef.current / CARD_STRIDE) - VIRTUAL_BUFFER
          const newStart = Math.max(0, Math.min(rawStart, missions.length - 1))
          if (newStart !== lastVirtualStartRef.current) {
            lastVirtualStartRef.current = newStart
            setVirtualStart(newStart)
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [missions.length, loopWidth, isVirtual])

  // ── Pause handlers (hover on desktop, touch on mobile) ────────────────────
  const pause = useCallback(() => { pausedRef.current = true }, [])
  const resume = useCallback(() => { pausedRef.current = false }, [])

  // ── Virtual window slice ──────────────────────────────────────────────────
  const virtualEndIdx = virtualStart + visibleCount + VIRTUAL_BUFFER * 2
  // Wrap around if we need more items than the array length
  function getVirtualItem(idx: number): MissionCardData | null {
    if (idx < 0 || idx >= missions.length) return null
    return missions[idx]
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Left / right edge fades */}
      <div
        className="pointer-events-none absolute left-0 top-0 z-10 h-full w-16"
        style={{ background: 'linear-gradient(to right, #020617, transparent)' }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 z-10 h-full w-16"
        style={{ background: 'linear-gradient(to left, #020617, transparent)' }}
      />

      {/* Viewport clip */}
      <div className="overflow-hidden px-8">
        {/* Track — transform driven imperatively by RAF */}
        <div
          ref={trackRef}
          style={{
            display: 'flex',
            gap: GAP,
            willChange: 'transform',
            // Virtual: track spans full logical width so items are correctly spaced
            ...(isVirtual && {
              position: 'relative',
              width: loopWidth,
            }),
          }}
          onMouseEnter={pause}
          onMouseLeave={resume}
          onTouchStart={pause}
          onTouchEnd={resume}
        >
          {isVirtual ? (
            // ── Virtual mode: render only visible slice ───────────────────
            Array.from({ length: virtualEndIdx - virtualStart }, (_, i) => {
              const idx = virtualStart + i
              const m = getVirtualItem(idx)
              if (!m) return null
              return (
                <div
                  key={m.id}
                  style={{
                    position: 'absolute',
                    left: idx * CARD_STRIDE,
                    top: 0,
                  }}
                >
                  <MissionCard
                    mission={m}
                    onClick={() => onCardClick(m.id)}
                    highlighted={m.id === highlightedMissionId}
                  />
                </div>
              )
            })
          ) : (
            // ── Standard mode: duplicated list for seamless loop ──────────
            displayMissions.map((m, i) => (
              <MissionCard
                key={`${m.id}-${i}`}
                mission={m}
                onClick={() => onCardClick(m.id)}
                highlighted={m.id === highlightedMissionId}
              />
            ))
          )}

          {/* "New Mission" slot — only in standard mode, appended after last item */}
          {!isVirtual && (
            <button
              type="button"
              onClick={onNewMission}
              onMouseEnter={pause}
              onMouseLeave={resume}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: CARD_W,
                flexShrink: 0,
                minHeight: 120,
                borderRadius: 17,
                border: '1px dashed rgba(59,130,246,0.18)',
                background: 'rgba(59,130,246,0.03)',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(59,130,246,0.10)',
                  border: '1px solid rgba(59,130,246,0.20)',
                }}
              >
                <Plus style={{ width: 13, height: 13, color: 'rgba(96,165,250,0.65)' }} />
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  color: 'rgba(255,255,255,0.22)',
                }}
              >
                New Mission
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
