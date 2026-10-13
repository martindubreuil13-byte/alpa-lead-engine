import Link from 'next/link'

import type { SearchFailure } from '@/lib/guest/search-errors'

const LINK =
  'inline-flex min-h-[48px] items-center rounded text-base text-[#d8c28a] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]'

function Panel({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} className="dash-rise mx-auto w-full max-w-3xl pt-2 sm:pt-6">
      {children}
    </section>
  )
}

/** A returning visitor who has businesses saved and searches left: recognised, not asked to start over. */
export function WelcomeBack({ saved, searches, onFindMore }: { saved: number; searches: number; onFindMore: () => void }) {
  return (
    <Panel label="Welcome back">
      <h1 className="font-display text-[2.5rem] leading-[1.04] tracking-tight text-white/95 sm:text-[3.5rem]">Welcome back.</h1>
      <p className="mt-5 text-lg leading-8 text-white/75">
        You have {saved} {saved === 1 ? 'business' : 'businesses'} saved from your previous {searches > 1 ? 'searches' : 'search'}.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
        <Link href="/trial/results" className="btn-primary-gold btn-quiet w-full uppercase tracking-[0.14em] sm:w-auto">
          View my businesses →
        </Link>
        <button type="button" onClick={onFindMore} className={LINK}>
          Find more businesses →
        </button>
      </div>
    </Panel>
  )
}

/** A search that could not finish, in plain words, with the right next step. */
export function SearchFailed({ failure, message, onTryAgain }: { failure: SearchFailure | null; message?: string; onTryAgain: () => void }) {
  const text = failure?.message ?? message ?? 'The search could not be completed. Please try again.'
  const retryable = failure?.retryable ?? true
  const resultsAvailable = failure?.resultsAvailable ?? false
  return (
    <Panel label="Search incomplete">
      <h1 className="font-display text-[2.25rem] leading-[1.06] tracking-tight text-white/95 sm:text-[3rem]">
        {failure?.kind === 'limit' || failure?.kind === 'running' ? 'Your businesses are ready.' : 'This search did not finish.'}
      </h1>
      <p role="alert" className="mt-5 text-lg leading-8 text-white/75">{text}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-8">
        {resultsAvailable ? (
          <Link href="/trial/results" className="btn-primary-gold btn-quiet w-full uppercase tracking-[0.14em] sm:w-auto">
            View my businesses →
          </Link>
        ) : null}
        {retryable || !resultsAvailable ? (
          <button type="button" onClick={onTryAgain} className={resultsAvailable ? LINK : 'btn-primary-gold btn-quiet w-full uppercase tracking-[0.14em] sm:w-auto'}>
            {retryable ? 'Try again' : 'Adjust search'}
          </button>
        ) : null}
      </div>
    </Panel>
  )
}
