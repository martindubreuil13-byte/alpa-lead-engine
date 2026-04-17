'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type SoundType = 'start' | 'lead' | 'complete' | 'error'

const STORAGE_KEY = 'alpa_sound_enabled'
const MAX_VOLUME = 0.18
const DEBOUNCE_MS = 1000

// Singleton AudioContext — persists across renders/navigations
let _ctx: AudioContext | null = null
let _unlockRegistered = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!_ctx || _ctx.state === 'closed') {
    try {
      _ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )()
    } catch {
      return null
    }
  }
  return _ctx
}

/**
 * Register a one-time click listener that resumes the AudioContext.
 * Browsers suspend audio until user interaction — this unlocks it.
 * Safe to call multiple times; registers only once.
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined' || _unlockRegistered) return
  _unlockRegistered = true
  document.addEventListener(
    'click',
    () => {
      const ctx = getCtx()
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
    },
    { once: true }
  )
}

// ─── Synthesized sounds ───────────────────────────────────────────────────────

function synthStart(ctx: AudioContext) {
  const len = ctx.sampleRate * 0.45
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.35

  const src = ctx.createBufferSource()
  src.buffer = buf

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(300, ctx.currentTime)
  filter.frequency.linearRampToValueAtTime(1400, ctx.currentTime + 0.38)
  filter.Q.value = 0.9

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(MAX_VOLUME * 0.55, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45)

  src.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  src.start()
  src.stop(ctx.currentTime + 0.45)
}

function synthLead(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(900, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.09)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(MAX_VOLUME * 0.45, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.12)
}

function synthComplete(ctx: AudioContext) {
  const notes = [523.25, 659.25]
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq

    const gain = ctx.createGain()
    const t = ctx.currentTime + i * 0.07
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(MAX_VOLUME * 0.55, t + 0.04)
    gain.gain.linearRampToValueAtTime(0, t + 0.65)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.7)
  })
}

function synthError(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(260, ctx.currentTime)
  osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.2)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(MAX_VOLUME * 0.38, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.28)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.3)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSound() {
  const lastPlayed = useRef(new Map<SoundType, number>())
  const enabledRef = useRef(false)
  const [enabled, setEnabledState] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) === 'true'
    enabledRef.current = stored
    setEnabledState(stored)
    // Register audio unlock listener as soon as hook mounts
    unlockAudio()
  }, [])

  const play = useCallback((type: SoundType) => {
    if (!enabledRef.current) return
    const now = Date.now()
    if (now - (lastPlayed.current.get(type) ?? 0) < DEBOUNCE_MS) return
    lastPlayed.current.set(type, now)

    console.log(`sound:${type}`) // debug — remove once verified

    const ctx = getCtx()
    if (!ctx) return

    const run = () => {
      try {
        if (type === 'start') synthStart(ctx)
        else if (type === 'lead') synthLead(ctx)
        else if (type === 'complete') synthComplete(ctx)
        else synthError(ctx)
      } catch (e) {
        console.warn('sound synthesis failed', e)
      }
    }

    if (ctx.state === 'suspended') {
      ctx.resume().then(run).catch(() => {})
    } else {
      run()
    }
  }, [])

  const toggle = useCallback(() => {
    const next = !enabledRef.current
    enabledRef.current = next
    setEnabledState(next)
    localStorage.setItem(STORAGE_KEY, String(next))
    // If enabling, immediately unlock audio on this interaction
    if (next) {
      const ctx = getCtx()
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {})
    }
  }, [])

  return { play, toggle, enabled }
}
