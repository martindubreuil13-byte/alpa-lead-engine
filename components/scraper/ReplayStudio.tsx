'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { buildEngineView, ACHIEVEMENT_HOLD_MS } from '@/lib/scraper/engine-view'
import { replayStateAt } from '@/lib/scraper/replay'
import { getReplayScenario, REPLAY_SCENARIOS } from '@/lib/scraper/replay-fixture'
import { describeSettledNote, summarizeContacts, toResultRow } from '@/lib/scraper/results-summary'

import DiscoverEngine from './DiscoverEngine'
import ResultsIndex from './ResultsIndex'
import usePrefersReducedMotion from './usePrefersReducedMotion'
import useResultsReveal from './useResultsReveal'

const TICK_MS = 80
const END_HOLD_MS = 3000
const SPEEDS = [0.5, 1, 2]

// DEMO / REPLAY. Local development only. It plays an illustrative, simulated event sequence
// through the same presentation model and components as a real search. It never imports the
// network layer, never calls /api/scrape, and never writes anything.
export default function ReplayStudio() {
  const [scenarioId, setScenarioId] = useState(REPLAY_SCENARIOS[0].id)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [runKey, setRunKey] = useState(0)
  const reducedMotion = usePrefersReducedMotion()
  const engineRef = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const scenario = getReplayScenario(scenarioId)
  const endAt = scenario.durationMs + END_HOLD_MS

  // Review aid: /dashboard/discover-replay?scenario=standard&t=7000 opens paused on that moment
  // (add &play=1 to keep playing from there). Read after mount so the server render stays stable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedScenario = params.get('scenario')
    if (requestedScenario) setScenarioId(getReplayScenario(requestedScenario).id)
    const at = Number(params.get('t'))
    if (params.has('t') && Number.isFinite(at) && at >= 0) {
      setT(at)
      setPlaying(params.get('play') === '1')
    }
  }, [])

  // The timer stops for good once the replay reaches its end, instead of ticking forever.
  const atEnd = t >= endAt
  useEffect(() => {
    if (!playing || atEnd) return
    const timer = window.setInterval(() => {
      setT((current) => {
        const next = current + TICK_MS * speed
        return next >= endAt ? endAt : next
      })
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [playing, speed, endAt, atEnd])

  const state = useMemo(() => replayStateAt(scenario, t), [scenario, t])
  const view = useMemo(
    () =>
      buildEngineView({
        progress: state.progress,
        timings: state.timings,
        nowMs: t,
        lastEventAt: state.lastEventAt,
        requestedCount: scenario.requested,
        businessType: scenario.query,
        location: scenario.location,
        running: state.running,
        holdMs: reducedMotion ? 0 : ACHIEVEMENT_HOLD_MS,
      }),
    [state, t, scenario, reducedMotion]
  )

  const settled = state.finished
  const contacts = useMemo(() => summarizeContacts(scenario.leads), [scenario])
  const rows = useMemo(
    // Replay rows point at an in-page anchor: a replay never navigates to a real lead.
    () => scenario.leads.map((lead) => ({ ...toResultRow(lead), detailHref: `#fixture-${lead.id}` })),
    [scenario]
  )
  const note = describeSettledNote({
    discovered: state.progress.discoveredFinal,
    added: scenario.leads.length,
    duplicates: 0,
    invalid: 0,
  })

  useResultsReveal({ ready: settled, reducedMotion, anchorRef: engineRef, headingRef, engineRef })

  function restart(nextScenario = scenarioId) {
    setScenarioId(nextScenario)
    setT(0)
    setRunKey((key) => key + 1)
    setPlaying(true)
  }

  const finished = t >= endAt
  const button =
    'inline-flex min-h-[40px] items-center justify-center rounded-lg border border-white/15 px-4 text-xs uppercase tracking-[0.16em] text-white/85 transition hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a]'

  return (
    <div className="mx-auto w-full max-w-5xl pb-16">
      <div role="note" className="border-y border-[#d8c28a]/50 py-4">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[#d8c28a]">Demo / Replay</p>
        <p className="mt-2 text-sm text-white/80">
          This is a simulation for design review. Timings are illustrative, not measured. No search is running, no
          paid service is called, and nothing is saved.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className={button} onClick={() => setPlaying((value) => !value)} disabled={finished && playing}>
          {playing && !finished ? 'Pause' : 'Play'}
        </button>
        <button type="button" className={button} onClick={() => restart()}>
          Restart
        </button>
        <div className="flex items-center gap-2" role="group" aria-label="Playback speed">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={speed === value}
              onClick={() => setSpeed(value)}
              className={`${button} ${speed === value ? 'border-[#d8c28a] text-white' : ''}`}
            >
              {value}×
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/70">
          Scenario
          <select
            value={scenarioId}
            onChange={(event) => restart(event.target.value)}
            className="rounded-lg border border-white/15 bg-[#07111f] px-3 py-2 text-xs text-white"
          >
            {REPLAY_SCENARIOS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-white/60">{scenario.description}</p>

      <div className="mt-10">
        <DiscoverEngine
          key={`${scenarioId}-${runKey}`}
          view={view}
          activity={state.activity}
          results={settled ? contacts : null}
          settledNote={settled ? note : null}
          onNewSearch={() => restart()}
          footnote="Replay: all timings are illustrative."
          rootRef={engineRef}
        />
        {settled ? (
          <ResultsIndex
            rows={rows}
            headingRef={headingRef}
            profileNote="Business Profiles are available separately."
            note={null}
            actions={<span className="text-sm text-[#5b6372]">Replay data: fictional businesses</span>}
          />
        ) : null}
      </div>
    </div>
  )
}
