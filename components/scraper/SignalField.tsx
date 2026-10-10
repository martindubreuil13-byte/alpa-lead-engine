import type { SignalState } from '@/lib/scraper/engine-view'

type SignalFieldProps = {
  states: SignalState[]
  /** Text alternative for screen readers; the dots themselves are decorative. */
  summary: string
}

const DOT: Record<SignalState, string> = {
  email: 'h-2.5 w-2.5 bg-[#d8c28a] border-[#d8c28a]',
  checked: 'h-2.5 w-2.5 bg-white/80 border-white/80',
  waiting: 'h-2.5 w-2.5 border-white/35',
  skipped: 'h-1.5 w-1.5 border-white/20 bg-white/15',
}

// One anonymous signal per discovered business. The mix of states is real and aggregate:
// how many website checks have finished and how many of those found an email address. A signal's
// position does not identify a particular business, and nothing here animates continuously: a dot
// changes only when a real event changes it.
export default function SignalField({ states, summary }: SignalFieldProps) {
  if (states.length === 0) return null

  return (
    <div className="signals-in mx-auto mt-6 w-full max-w-sm">
      <div aria-hidden="true" className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-3 py-2">
        {states.map((state, index) => (
          <span key={`${index}-${state}`} className="inline-flex h-4 w-4 items-center justify-center">
            {/* The key includes the state, so only a signal whose state really changed replays its pop. */}
            <span
              className={`rounded-full border transition-colors duration-500 ${DOT[state]} ${
                state === 'email' || state === 'checked' ? 'signal-pop' : ''
              }`}
            />
          </span>
        ))}
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  )
}
