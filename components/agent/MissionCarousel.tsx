'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'

import { MissionCard, type MissionCardData } from './MissionCard'

// ─── Layout ───────────────────────────────────────────────────────────────────

const CARD_W = 210
const GAP = 12
const CARD_STRIDE = CARD_W + GAP       // 222 px per slot

// ─── Scroll behaviour ─────────────────────────────────────────────────────────

const SCROLL_PX = 0.38                  // px per frame during auto-scroll (~23 px/s @ 60 fps)
const ARROW_SHIFT = CARD_STRIDE * 1.5  // px shifted on each arrow click
const ARROW_DURATION = 340             // ms for arrow easing
const INERTIA_DECAY = 0.94             // velocity factor per 16.67 ms frame
const INERTIA_MIN_VX = 0.04           // px/ms below which inertia is considered done
const AUTO_RESUME_MS = 2000            // ms of inactivity before auto-scroll resumes
const DRAG_THRESHOLD_PX = 5            // px of movement to classify pointer as drag
const VEL_SAMPLE_MS = 100             // sliding window for release-velocity sampling

// ─── Virtualization ───────────────────────────────────────────────────────────

const VIRTUAL_THRESHOLD = 20
const VIRTUAL_BUFFER = 3

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  missions: MissionCardData[]
  onCardClick: (id: string) => void
  onNewMission: () => void
  onDeleteMission: (id: string) => Promise<void>
  highlightedMissionId?: string | null
}

// ─── Easing ───────────────────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MissionCarousel = memo(function MissionCarousel({
  missions,
  onCardClick,
  onNewMission,
  onDeleteMission,
  highlightedMissionId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const deletingMissionIdsRef = useRef<Set<string>>(new Set())

  // ── Core scroll refs (never trigger re-render) ───────────────────────────

  const offsetRef = useRef(0)              // current translateX (negative = scrolled right)
  const rafRef = useRef<number>(0)
  const lastTickRef = useRef(0)

  // Phases — only one is active at a time
  const isDraggingRef = useRef(false)
  const inertiaRef = useRef(false)
  const arrowAnimRef = useRef(false)

  // Auto-scroll: paused by hover; drag/inertia/arrow use their own phase flags
  const hoverPausedRef = useRef(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drag tracking
  const didDragRef = useRef(false)       // true once movement exceeds threshold
  const dragStartXRef = useRef(0)
  const dragStartOffsetRef = useRef(0)
  const velSamplesRef = useRef<{ x: number; t: number }[]>([])
  const velocityRef = useRef(0)          // px/ms — positive = rightward motion

  // Document-level drag listeners (stored in refs so they can be removed)
  // Using document listeners instead of setPointerCapture avoids the browser
  // retargeting the subsequent click event to the capturing element — which was
  // causing card clicks to fire on the clip div rather than on the card button.
  const docMoveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const docUpRef = useRef<((e: PointerEvent) => void) | null>(null)

  // ── Virtual rendering state ──────────────────────────────────────────────

  const [virtualStart, setVirtualStart] = useState(0)
  const lastVirtualStartRef = useRef(-1)
  const [containerWidth, setContainerWidth] = useState(800)

  const isVirtual = missions.length > VIRTUAL_THRESHOLD
  const loopWidth = missions.length * CARD_STRIDE

  // Standard mode: duplicate array for seamless looping
  const displayMissions: MissionCardData[] = isVirtual
    ? missions
    : [...missions, ...missions]

  const visibleCount = Math.ceil(containerWidth / CARD_STRIDE) + 2

  // ── Container width ──────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerWidth(el.offsetWidth))
    ro.observe(el)
    setContainerWidth(el.offsetWidth)
    return () => ro.disconnect()
  }, [])

  // ── Cleanup document listeners on unmount ────────────────────────────────

  useEffect(() => {
    return () => {
      if (docMoveRef.current) {
        document.removeEventListener('pointermove', docMoveRef.current)
        docMoveRef.current = null
      }
      if (docUpRef.current) {
        document.removeEventListener('pointerup', docUpRef.current)
        document.removeEventListener('pointercancel', docUpRef.current)
        docUpRef.current = null
      }
    }
  }, [])

  // ── Pure helpers (no state — used from RAF and event handlers) ───────────

  function applyTransform() {
    if (trackRef.current) {
      trackRef.current.style.transform = `translateX(${offsetRef.current}px)`
    }
  }

  // Wrap offset so it stays in the valid looped range
  function normalizeOffset() {
    if (isVirtual || loopWidth === 0) return
    // Scrolled past end of second copy → wrap to start
    if (-offsetRef.current >= loopWidth) {
      offsetRef.current += loopWidth
    }
    // Dragged too far right past origin → wrap to end of first copy
    if (offsetRef.current > 0) {
      offsetRef.current -= loopWidth
    }
  }

  // Schedule auto-scroll to resume after a period of inactivity
  function scheduleResume() {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      hoverPausedRef.current = false
    }, AUTO_RESUME_MS)
  }

  // Update the virtual render window (only causes a React re-render when the
  // window actually shifts — roughly every 10s at default auto-scroll speed)
  function updateVirtualWindow() {
    if (!isVirtual) return
    const rawStart = Math.floor(-offsetRef.current / CARD_STRIDE) - VIRTUAL_BUFFER
    const clamped = Math.max(0, Math.min(rawStart, missions.length - 1))
    if (clamped !== lastVirtualStartRef.current) {
      lastVirtualStartRef.current = clamped
      setVirtualStart(clamped)
    }
  }

  function setCursor(c: string) {
    if (clipRef.current) clipRef.current.style.cursor = c
  }

  function setMissionDeletingState(id: string, deleting: boolean) {
    const root = containerRef.current
    if (!root) return

    const escapedId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(id)
        : id

    const cards = root.querySelectorAll<HTMLElement>(`[data-mission-card-id="${escapedId}"]`)
    const buttons = root.querySelectorAll<HTMLButtonElement>(`[data-mission-delete-id="${escapedId}"]`)

    cards.forEach((card) => {
      card.style.opacity = deleting ? '0.55' : ''
      card.style.pointerEvents = deleting ? 'none' : ''
    })

    buttons.forEach((button) => {
      button.disabled = deleting
      button.style.opacity = deleting ? '0.45' : ''
      button.style.pointerEvents = deleting ? 'none' : ''
    })
  }

  async function handleDeleteClick(
    e: React.MouseEvent<HTMLButtonElement>,
    missionId: string,
  ) {
    e.stopPropagation()

    if (deletingMissionIdsRef.current.has(missionId)) return
    if (!confirm('Delete this mission?')) return

    deletingMissionIdsRef.current.add(missionId)
    setMissionDeletingState(missionId, true)

    try {
      await onDeleteMission(missionId)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }

      console.error('Mission delete failed:', error)
      setMissionDeletingState(missionId, false)
    } finally {
      deletingMissionIdsRef.current.delete(missionId)
      setMissionDeletingState(missionId, false)
    }
  }

  // ── Remove document drag listeners ──────────────────────────────────────

  function removeDragListeners() {
    if (docMoveRef.current) {
      document.removeEventListener('pointermove', docMoveRef.current)
      docMoveRef.current = null
    }
    if (docUpRef.current) {
      document.removeEventListener('pointerup', docUpRef.current)
      document.removeEventListener('pointercancel', docUpRef.current)
      docUpRef.current = null
    }
  }

  // ── Main RAF loop ────────────────────────────────────────────────────────
  // Runs continuously. Phases (drag / inertia / arrow) block the auto-scroll
  // branch but the loop still ticks for virtual-window bookkeeping.

  useEffect(() => {
    if (missions.length === 0) return

    function tick(now: number) {
      const dt = lastTickRef.current
        ? Math.min(now - lastTickRef.current, 50)  // cap at 50 ms to handle tab-switch lag
        : 16.67
      lastTickRef.current = now

      if (!isDraggingRef.current && !arrowAnimRef.current) {
        if (inertiaRef.current) {
          // ── Inertia ─────────────────────────────────────────────────────
          offsetRef.current += velocityRef.current * dt
          velocityRef.current *= Math.pow(INERTIA_DECAY, dt / 16.67)
          normalizeOffset()
          applyTransform()

          if (Math.abs(velocityRef.current) < INERTIA_MIN_VX) {
            inertiaRef.current = false
            scheduleResume()
          }
        } else if (!hoverPausedRef.current) {
          // ── Auto-scroll ──────────────────────────────────────────────────
          offsetRef.current -= SCROLL_PX
          normalizeOffset()
          applyTransform()
        }
      }

      updateVirtualWindow()
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions.length, loopWidth, isVirtual])

  // ── Arrow click animation ────────────────────────────────────────────────
  // Runs an independent RAF chain alongside the main loop.
  // arrowAnimRef blocks the main loop from changing the offset during animation.

  function animateArrow(direction: 'left' | 'right') {
    // "right" arrow → scroll content leftward → offset decreases (negative delta)
    // "left"  arrow → scroll content rightward → offset increases (positive delta)
    const delta = direction === 'right' ? -ARROW_SHIFT : ARROW_SHIFT

    hoverPausedRef.current = true
    inertiaRef.current = false
    arrowAnimRef.current = true
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)

    const startOffset = offsetRef.current
    const target = startOffset + delta
    const t0 = performance.now()

    function step(now: number) {
      const elapsed = now - t0
      const progress = Math.min(elapsed / ARROW_DURATION, 1)
      offsetRef.current = startOffset + (target - startOffset) * easeOutCubic(progress)
      normalizeOffset()
      applyTransform()

      if (progress < 1) {
        requestAnimationFrame(step)
      } else {
        arrowAnimRef.current = false
        scheduleResume()
      }
    }

    requestAnimationFrame(step)
  }

  // ── Pointer event handlers ───────────────────────────────────────────────
  // We use document-level listeners (not setPointerCapture) so that the
  // click event is always dispatched to the actual element under the cursor.
  // With setPointerCapture on the clip div, pointerup fires on the clip div
  // and some browsers retarget the click to that element — the card button's
  // onClick never fires because click bubbles up, not down to child buttons.

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Ignore non-primary mouse buttons
    if (e.pointerType === 'mouse' && e.button !== 0) return

    isDraggingRef.current = true
    didDragRef.current = false
    inertiaRef.current = false
    hoverPausedRef.current = true
    arrowAnimRef.current = false   // abort any in-progress arrow animation
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)

    dragStartXRef.current = e.clientX
    dragStartOffsetRef.current = offsetRef.current
    velSamplesRef.current = [{ x: e.clientX, t: e.timeStamp }]
    setCursor('grabbing')

    // Remove any stale listeners from a prior interrupted drag
    removeDragListeners()

    const handleMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return

      const dx = ev.clientX - dragStartXRef.current

      if (!didDragRef.current && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        didDragRef.current = true
      }

      offsetRef.current = dragStartOffsetRef.current + dx
      normalizeOffset()
      applyTransform()

      // Keep only the last VEL_SAMPLE_MS worth of samples for release velocity
      const now = ev.timeStamp
      velSamplesRef.current.push({ x: ev.clientX, t: now })
      velSamplesRef.current = velSamplesRef.current.filter((s) => now - s.t <= VEL_SAMPLE_MS)
    }

    const handleUp = (_ev: PointerEvent) => {
      isDraggingRef.current = false
      setCursor('grab')
      removeDragListeners()

      // Compute release velocity from the recent sample window
      const samples = velSamplesRef.current
      let vx = 0
      if (samples.length >= 2) {
        const first = samples[0]
        const last = samples[samples.length - 1]
        const dt = last.t - first.t
        if (dt > 0) vx = (last.x - first.x) / dt
      }

      velocityRef.current = vx

      if (Math.abs(vx) > INERTIA_MIN_VX) {
        inertiaRef.current = true
        // scheduleResume() fires from inside the RAF loop once inertia settles
      } else {
        scheduleResume()
      }
    }

    docMoveRef.current = handleMove
    docUpRef.current = handleUp

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
    document.addEventListener('pointercancel', handleUp)
  }

  // Suppress card click events that follow a drag gesture.
  // Runs in capture phase so it intercepts before the card button's onClick.
  function onClickCapture(e: React.MouseEvent) {
    if (didDragRef.current) {
      e.stopPropagation()
      didDragRef.current = false
    }
  }

  // Hover pause — desktop only (touch devices use pointer events above)
  function onMouseEnter() {
    if (!isDraggingRef.current) hoverPausedRef.current = true
  }
  function onMouseLeave() {
    // Only resume immediately if no interaction is pending;
    // otherwise let scheduleResume() handle it when inertia settles.
    if (!isDraggingRef.current && !inertiaRef.current) {
      hoverPausedRef.current = false
    }
  }

  // ── Virtual window slice ─────────────────────────────────────────────────

  const virtualEndIdx = virtualStart + visibleCount + VIRTUAL_BUFFER * 2

  function getVirtualItem(idx: number): MissionCardData | null {
    if (idx < 0 || idx >= missions.length) return null
    return missions[idx]
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* ── Edge fades (pointer-events:none so they don't block drag) ──── */}
      <div
        className="pointer-events-none absolute left-0 top-0 z-10 h-full w-14"
        style={{ background: 'linear-gradient(to right, #020617 30%, transparent)' }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 z-10 h-full w-20"
        style={{ background: 'linear-gradient(to left, #020617 20%, transparent)' }}
      />

      {/* ── Desktop arrow buttons ─────────────────────────────────────── */}
      <ArrowButton direction="left" onClick={() => animateArrow('left')} />
      <ArrowButton direction="right" onClick={() => animateArrow('right')} />

      {/* ── Viewport clip + drag surface ─────────────────────────────── */}
      {/* paddingRight: 0 lets the rightmost partial card bleed into the fade
          — this is the mobile "peek" cue */}
      <div
        ref={clipRef}
        className="overflow-hidden"
        style={{
          paddingLeft: 28,
          paddingRight: 0,
          cursor: 'grab',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          // Allow vertical scroll on mobile; capture horizontal drag
          touchAction: 'pan-y',
        }}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* ── Track ──────────────────────────────────────────────────── */}
        <div
          ref={trackRef}
          style={{
            display: 'flex',
            gap: GAP,
            willChange: 'transform',
            paddingBottom: 4,    // prevents card box-shadow clipping
            ...(isVirtual && { position: 'relative', width: loopWidth }),
          }}
        >
  {isVirtual ? (
  // Virtual mode
  Array.from({ length: virtualEndIdx - virtualStart }, (_, i) => {
    const idx = virtualStart + i
    const m = getVirtualItem(idx)
    if (!m) return null
    return (
      <div
        key={m.id}
        data-mission-card-id={m.id}
        style={{ position: 'absolute', left: idx * CARD_STRIDE, top: 0 }}
      >
        <div style={{ position: 'relative' }}>
          <MissionCard
            mission={m}
            onClick={() => {
              if (m.id) onCardClick(m.id)
            }}
            highlighted={m.id === highlightedMissionId}
          />

          <button
            type="button"
            data-mission-delete-id={m.id}
            onClick={(e) => void handleDeleteClick(e, m.id)}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'rgba(255,0,0,0.15)',
              border: '1px solid rgba(255,0,0,0.3)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 10,
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            ×
          </button>
        </div>
      </div>
    )
  })
) : (
  <>
    {displayMissions.map((m, i) => (
      <div key={`${m.id}-${i}`} data-mission-card-id={m.id} style={{ position: 'relative' }}>
        <MissionCard
          mission={m}
          onClick={() => {
            if (m.id) onCardClick(m.id)
          }}
          highlighted={m.id === highlightedMissionId}
        />

        <button
          type="button"
          data-mission-delete-id={m.id}
          onClick={(e) => void handleDeleteClick(e, m.id)}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'rgba(255,0,0,0.15)',
            border: '1px solid rgba(255,0,0,0.3)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 10,
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          ×
        </button>
      </div>
    ))}

    <NewMissionCard onClick={onNewMission} />
  </>
)}
        </div>
      </div>
    </div>
  )
})

// ─── Arrow button ──────────────────────────────────────────────────────────────

function ArrowButton({
  direction,
  onClick,
}: {
  direction: 'left' | 'right'
  onClick: () => void
}) {
  const isLeft = direction === 'left'

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/10 backdrop-blur-sm md:flex"
      style={{
        [isLeft ? 'left' : 'right']: 4,
        width: 30,
        height: 30,
        background: 'rgba(8,13,28,0.75)',
        opacity: 0.38,
        transition: 'opacity 0.18s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.38' }}
    >
      {isLeft
        ? <ChevronLeft style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.82)' }} />
        : <ChevronRight style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.82)' }} />
      }
    </button>
  )
}

// ─── New Mission card ─────────────────────────────────────────────────────────

function NewMissionCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: CARD_W,
        flexShrink: 0,
        minHeight: 118,
        borderRadius: 17,
        border: '1px dashed rgba(59,130,246,0.17)',
        background: 'rgba(59,130,246,0.025)',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(59,130,246,0.09)',
          border: '1px solid rgba(59,130,246,0.19)',
        }}
      >
        <Plus style={{ width: 12, height: 12, color: 'rgba(96,165,250,0.60)' }} />
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.08em',
          color: 'rgba(255,255,255,0.20)',
        }}
      >
        New Mission
      </span>
    </button>
  )
}
// deploy test
