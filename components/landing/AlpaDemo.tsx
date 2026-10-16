'use client'

import { Globe, Mail, Pause, Phone, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import { DEMO_BUSINESSES, DEMO_FEATURED, DEMO_SEARCH, DEMO_STAGES, DEMO_TEXT_ALTERNATIVE, demoMapDots } from '@/components/landing/alpa-demo-data'
import styles from '@/components/landing/AlpaDemo.module.css'

// A demonstration of ALPA's workflow: DISCOVER -> ENRICH -> AI INTELLIGENCE, played with sample, fictional businesses.
//
// How it works. The scenes are CSS animations (opacity and transform only, so they run off the main thread); a small timer moves from
// one stage to the next and a tab per stage lets the visitor choose. It plays only while it is on screen and the tab is visible, has a
// pause button, and does not move at all for people who ask their system for reduced motion (they get the finished picture and the
// stage buttons). It makes no network request, loads no library, and the server renders the same first frame the browser starts from.

const dots = demoMapDots(DEMO_SEARCH.count)
const delay = (ms: number): CSSProperties => ({ ['--d' as string]: `${ms}ms` })
const ROWS = DEMO_BUSINESSES

function useCountUp(target: number, delayMs: number, durationMs: number, animate: boolean) {
  const [value, setValue] = useState(animate ? 0 : target)
  useEffect(() => {
    if (!animate) { setValue(target); return }
    setValue(0)
    let frame = 0
    const started = performance.now() + delayMs
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / durationMs))
      setValue(Math.round((1 - Math.pow(1 - progress, 3)) * target))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, delayMs, durationMs, animate])
  return value
}

export default function AlpaDemo() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [paused, setPaused] = useState(false)
  const [onScreen, setOnScreen] = useState(true)
  const [tabVisible, setTabVisible] = useState(true)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const element = rootRef.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.25 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const apply = () => setTabVisible(document.visibilityState === 'visible')
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [])

  const playing = !reduced && !paused && onScreen && tabVisible

  // The time left in the current stage survives a pause or the demonstration scrolling out of view.
  const remaining = useRef<number>(DEMO_STAGES[0].ms)
  useEffect(() => { remaining.current = DEMO_STAGES[stage].ms }, [stage, cycle])
  useEffect(() => {
    if (!playing) return
    const startedAt = Date.now()
    const timer = window.setTimeout(() => {
      if (stage < DEMO_STAGES.length - 1) setStage(stage + 1)
      else { setStage(0); setCycle((value) => value + 1) }
    }, remaining.current)
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt)) }
  }, [playing, stage, cycle])

  const choose = useCallback((index: number) => {
    setStage(index)
    if (index === 0) setCycle((value) => value + 1)
  }, [])

  // A slight lean toward the pointer on a desktop with a mouse; never on touch screens or with reduced motion.
  const frame = useRef(0)
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || event.pointerType !== 'mouse') return
    const element = rootRef.current
    if (!element) return
    const { clientX, clientY } = event
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const box = element.getBoundingClientRect()
      const x = (clientX - box.left) / box.width - 0.5
      const y = (clientY - box.top) / box.height - 0.5
      element.style.setProperty('--ry', `${(x * 3.2).toFixed(2)}deg`)
      element.style.setProperty('--rx', `${(-y * 2.4).toFixed(2)}deg`)
      element.style.setProperty('--lx', `${((x + 0.5) * 100).toFixed(1)}%`)
      element.style.setProperty('--ly', `${((y + 0.5) * 100).toFixed(1)}%`)
    })
  }
  const onPointerLeave = () => {
    const element = rootRef.current
    if (!element) return
    cancelAnimationFrame(frame.current)
    for (const name of ['--rx', '--ry', '--lx', '--ly']) element.style.removeProperty(name)
  }

  const count = useCountUp(DEMO_SEARCH.count, 1900, 2800, !reduced)
  const current = DEMO_STAGES[stage]

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-stage={current.id}
      data-playing={playing ? 'true' : 'false'}
      role="group"
      aria-label="ALPA workflow demonstration with sample data"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <p className={styles.srOnly}>{DEMO_TEXT_ALTERNATIVE}</p>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.window}>
        <div className={styles.sweep} aria-hidden="true" />

        <div className={styles.titleBar}>
          <span className={styles.brand} aria-hidden="true">ALPA</span>
          <span className={styles.demoPill}>Demonstration · sample data</span>
          <button type="button" className={styles.control} onClick={() => setPaused((value) => !value)} aria-pressed={paused} aria-label={paused ? 'Play the demonstration' : 'Pause the demonstration'} hidden={reduced}>
            {paused ? <Play aria-hidden="true" size={14} /> : <Pause aria-hidden="true" size={14} />}
          </button>
        </div>

        <div className={styles.rail} role="group" aria-label="Choose a step">
          {DEMO_STAGES.map((item, index) => (
            <button key={item.id} type="button" className={styles.railButton} data-active={index === stage ? 'true' : 'false'} aria-pressed={index === stage} onClick={() => choose(index)}>
              <span className={styles.railNumber}>{item.short}</span>
              <span className={styles.railLabel}>{item.label}</span>
              <span className={styles.railTrack} aria-hidden="true">
                {index === stage ? <span key={`${cycle}-${stage}`} className={styles.railFill} style={{ ['--ms' as string]: `${item.ms}ms` }} /> : null}
              </span>
            </button>
          ))}
        </div>

        <div className={styles.search} aria-hidden="true">
          <span className={styles.searchLabel}>Search</span>
          <span className={styles.searchText} key={`s${cycle}`}>
            <span className={styles.typed} style={{ ['--steps' as string]: 10, ...delay(250) }}>{DEMO_SEARCH.industry}</span>
            <span className={styles.dim}> · </span>
            <span className={styles.typed} style={{ ['--steps' as string]: 7, ...delay(1050) }}>{DEMO_SEARCH.location}</span>
            <span className={styles.caret} />
          </span>
          <span className={styles.count}><b>{count}</b> businesses</span>
        </div>

        <div className={styles.body}>
          <ul className={styles.list} key={`l${cycle}`} aria-hidden="true">
            {ROWS.map((business, index) => (
              <li key={business.name} className={styles.row} data-featured={index === 0 ? 'true' : 'false'} style={delay(1800 + index * 380)}>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{business.name}</span>
                  <span className={styles.rowMeta}>{business.area} · {business.kind}</span>
                </span>
                <span className={styles.chips}>
                  <Chip icon={<Globe size={13} />} on delayMs={9200 + index * 420} />
                  <Chip icon={<Phone size={13} />} on delayMs={9500 + index * 420} />
                  <Chip icon={<Mail size={13} />} on={business.email !== null} delayMs={9800 + index * 420} />
                </span>
              </li>
            ))}
            <li className={styles.more} style={delay(1800 + ROWS.length * 380)}>+ 18 more</li>
          </ul>

          <div className={styles.side} aria-hidden="true">
            {stage === 0 ? <DiscoverPanel /> : stage === 1 ? <EnrichPanel key={`e${cycle}`} /> : <IntelligencePanel key={`i${cycle}`} />}
          </div>
        </div>

        <p className={styles.footnote}>Sample businesses are fictional. Real results vary by business and location, and contact details appear only when a business publishes them.</p>
      </div>
    </div>
  )
}

function Chip({ icon, on, delayMs }: { icon: React.ReactNode; on: boolean; delayMs: number }) {
  return <span className={styles.chip} data-on={on ? 'true' : 'false'} style={delay(delayMs)}>{icon}</span>
}

function DiscoverPanel() {
  return (
    <div className={styles.map}>
      <p className={styles.panelLabel}>Finding businesses</p>
      <svg viewBox="0 0 400 240" className={styles.mapSvg} focusable="false">
        <g className={styles.mapLines}>
          <path d="M0 62 C90 48 150 90 240 70 S350 40 400 58" />
          <path d="M0 132 C70 150 160 112 250 138 S360 160 400 140" />
          <path d="M0 196 C100 182 180 214 290 192 S370 176 400 188" />
          <path d="M96 0 C110 70 84 130 108 240" />
          <path d="M214 0 C200 60 232 120 208 240" />
          <path d="M318 0 C330 80 304 150 324 240" />
        </g>
        {dots.map((dot, index) => (
          <g key={index} className={styles.dot} style={{ ...delay(1900 + index * 112), transformOrigin: `${dot.x}px ${dot.y}px` }}>
            <circle className={styles.dotRing} cx={dot.x} cy={dot.y} r="9" />
            <circle className={styles.dotCore} cx={dot.x} cy={dot.y} r="3.2" />
          </g>
        ))}
      </svg>
    </div>
  )
}

function EnrichPanel() {
  const f = DEMO_FEATURED
  const fields: { label: string; value: string; icon: React.ReactNode }[] = [
    { label: 'Website', value: f.website, icon: <Globe size={14} /> },
    { label: 'Phone', value: f.phone, icon: <Phone size={14} /> },
    { label: 'Email', value: f.email ?? 'Not publicly listed', icon: <Mail size={14} /> },
  ]
  return (
    <div className={styles.enrich}>
      <p className={styles.panelLabel}>Gathering public information</p>
      <h3 className={styles.featuredName}>{f.name}</h3>
      <p className={styles.featuredMeta}>{f.area}, Toronto · {f.kind}</p>
      <dl className={styles.fields}>
        {fields.map((field, index) => (
          <div key={field.label} className={styles.field} style={delay(500 + index * 900)}>
            <dt>{field.icon}<span>{field.label}</span></dt>
            <dd>
              <span className={styles.skeleton} aria-hidden="true" />
              <span className={styles.resolved}>{field.value}</span>
            </dd>
          </div>
        ))}
        <div className={`${styles.field} ${styles.fieldWide}`} style={delay(500 + 3 * 900)}>
          <dt><span>Description</span></dt>
          <dd>
            <span className={styles.skeleton} aria-hidden="true" />
            <span className={styles.resolved}>{f.description}</span>
          </dd>
        </div>
      </dl>
      <span className={styles.scan} aria-hidden="true" />
    </div>
  )
}

function IntelligencePanel() {
  const { profile, name, area, kind } = DEMO_FEATURED
  return (
    <div className={styles.profile}>
      <p className={styles.profileEyebrow}>AI business profile</p>
      <h3 className={styles.profileName}>{name}</h3>
      <p className={styles.profileMeta}>{area}, Toronto · {kind}</p>
      <p className={styles.summary}>
        {profile.summary.split('. ').map((sentence, index, all) => (
          <span key={index} className={styles.line} style={delay(900 + index * 1300)}>{sentence}{index < all.length - 1 ? '. ' : ''}</span>
        ))}
      </p>
      <p className={styles.mentionsLabel} style={delay(3800)}>What its website mentions</p>
      <ul className={styles.tags}>
        {profile.mentions.map((tag, index) => <li key={tag} className={styles.tag} style={delay(4000 + index * 220)}>{tag}</li>)}
      </ul>
      <p className={styles.source} style={delay(4900)}>Written from the information the business publishes. Details vary.</p>
    </div>
  )
}
