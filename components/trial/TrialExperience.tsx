'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import DiscoverEngine from '@/components/scraper/DiscoverEngine'
import DiscoverSearchForm from '@/components/scraper/DiscoverSearchForm'
import usePrefersReducedMotion from '@/components/scraper/usePrefersReducedMotion'
import { countOptions, describeAllowance, fetchGuestSnapshot, FREE_BUSINESSES } from '@/lib/guest/snapshot'
import type { GuestSnapshot } from '@/lib/guest/recovery'
import { ACHIEVEMENT_HOLD_MS, buildEngineView } from '@/lib/scraper/engine-view'
import { buildActivityItems } from '@/lib/scraper/live-activity'
import { trackEvent } from '@/lib/track'

import UpgradePanel from '@/components/conversion/UpgradePanel'
import { describeOfferEligibility } from '@/lib/billing/first-month-offer'

import { SearchFailed, WelcomeBack } from './TrialPanels'
import { useTrialSearch } from './useTrialSearch'

const RESULTS_HREF = '/trial/results'
// How long the settled summary stays before the results open on their own; the link is there for anyone who is quicker.
const AUTO_OPEN_MS = 1600

export default function TrialExperience() {
  const router = useRouter()
  const reducedMotion = usePrefersReducedMotion()
  const [snapshot, setSnapshot] = useState<GuestSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [wantsForm, setWantsForm] = useState(false)
  const [businessType, setBusinessType] = useState('')
  const [location, setLocation] = useState('')
  const [count, setCount] = useState('')
  const [showValidation, setShowValidation] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const typeRef = useRef<HTMLInputElement | null>(null)
  const locationRef = useRef<HTMLInputElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useTrialSearch({
    onFinished: () => {
      openTimer.current = setTimeout(() => router.push(RESULTS_HREF), reducedMotion ? 600 : AUTO_OPEN_MS)
    },
  })

  useEffect(() => () => { if (openTimer.current) clearTimeout(openTimer.current) }, [])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const sync = () => setIsMobile(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  // Returning visitors are recognised from the server's record of their signed trial; a search that is still running is resumed.
  const { resume } = search
  useEffect(() => {
    let cancelled = false
    void trackEvent('trial_page_viewed', { metadata: { source: 'trial_page' } })
    void fetchGuestSnapshot().then((data) => {
      if (cancelled) return
      setSnapshot(data)
      setLoaded(true)
      if (data?.searching) void resume()
    })
    return () => { cancelled = true }
  }, [resume])

  const allowance = describeAllowance(snapshot)
  const options = countOptions(allowance.remaining || FREE_BUSINESSES)
  const selectedCount = options.includes(count) ? count : options[options.length - 1]
  const missingBusinessType = !businessType.trim()
  const missingLocation = !location.trim()

  const submit = useCallback(() => {
    if (missingBusinessType || missingLocation) {
      setShowValidation(true)
      ;(missingBusinessType ? typeRef : locationRef).current?.focus()
      return
    }
    void search.start({ businessType, location, count: Number(selectedCount) })
  }, [missingBusinessType, missingLocation, search, businessType, location, selectedCount])

  const tryAgain = useCallback(() => {
    search.reset()
    setWantsForm(true)
    void fetchGuestSnapshot().then((data) => data && setSnapshot(data))
  }, [search])

  // The server refused a search because the free businesses or searches are used: show the upgrade moment, from the server's own
  // record of the allowance, instead of an error. (Other refusals, such as a busy network, stay plain messages.)
  const [limitSeen, setLimitSeen] = useState(false)
  const limitRefused = search.status === 'failed' && search.failure?.kind === 'limit'
  const { reset: resetSearch } = search
  useEffect(() => {
    if (!limitRefused) return
    setLimitSeen(true)
    resetSearch()
    void fetchGuestSnapshot().then((data) => data && setSnapshot(data))
  }, [limitRefused, resetSearch])

  if (!loaded) {
    return <p role="status" className="py-16 text-center text-white/70">Preparing your free search…</p>
  }

  // A search in progress (or just finished) is always the focus: the same engine view the application shows.
  if (search.status === 'running' || search.status === 'reconnecting' || search.status === 'finished') {
    const view = buildEngineView({
      progress: search.progress,
      timings: search.timings,
      nowMs: search.nowMs,
      lastEventAt: search.lastEventAt,
      requestedCount: search.requested,
      businessType: search.context.businessType,
      location: search.context.location,
      running: search.running,
      holdMs: reducedMotion ? 0 : ACHIEVEMENT_HOLD_MS,
    })
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {search.status === 'reconnecting' ? (
          <p role="status" className="rounded-xl border border-[#d8c28a]/30 bg-[#d8c28a]/[0.08] px-4 py-3 text-sm leading-6 text-[#f0e2b8]">
            The connection was interrupted. Your search keeps running on ALPA&apos;s servers, and we are reconnecting to it.
          </p>
        ) : null}
        <DiscoverEngine view={view} activity={buildActivityItems(search.logs)} footnote="Times are measured in your browser." />
        {search.status === 'finished' ? (
          <Link href={RESULTS_HREF} className="btn-primary-gold btn-quiet w-full uppercase tracking-[0.14em] sm:w-auto sm:self-start">
            View my businesses →
          </Link>
        ) : null}
      </div>
    )
  }

  if (search.status === 'failed') {
    return <SearchFailed failure={search.failure} onTryAgain={tryAgain} />
  }

  if (allowance.exhausted || limitSeen) {
    return (
      <UpgradePanel
        kind={allowance.used >= FREE_BUSINESSES || (limitSeen && allowance.attempts < 3) ? 'allowance' : 'searches'}
        saved={allowance.saved}
        eligible={describeOfferEligibility(null).eligible}
        audience="guest"
        secondaryHref={RESULTS_HREF}
      />
    )
  }

  if (allowance.saved > 0 && !wantsForm) {
    return <WelcomeBack saved={allowance.saved} searches={allowance.attempts} onFindMore={() => setWantsForm(true)} />
  }

  return (
    <DiscoverSearchForm
      businessType={businessType}
      location={location}
      resultCount={selectedCount}
      resultOptions={options}
      disabled={false}
      showValidation={showValidation}
      missingBusinessType={missingBusinessType}
      missingLocation={missingLocation}
      validationMessage=""
      usageText={
        allowance.saved > 0
          ? `${allowance.remaining} of ${FREE_BUSINESSES} free businesses left.`
          : `${FREE_BUSINESSES} free businesses. No account, email or card.`
      }
      submitDisabled={false}
      isMobile={isMobile}
      onBusinessTypeChange={setBusinessType}
      onLocationChange={setLocation}
      onResultCountChange={setCount}
      onSubmit={submit}
      businessTypeRef={typeRef}
      locationRef={locationRef}
    />
  )
}
