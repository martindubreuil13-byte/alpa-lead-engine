import Link from 'next/link'

import FloatingLeadShowcase from '@/components/landing/FloatingLeadShowcase'
import FreshStartCta from '@/components/landing/FreshStartCta'
import LiveLogPanel from '@/components/landing/LiveLogPanel'
import PublicHeader from '@/components/site/PublicHeader'

const comparisonPain = [
  'Search everywhere',
  'Open each site yourself',
  'Guess which contacts are real',
  'Start outreach after the energy is gone',
]

const comparisonWin = [
  'Pick a market',
  'See live companies appear',
  'Get contact details checked before they reach you',
  'Start with leads you can actually use',
]

const howItWorks = [
  'Finds real businesses in the market you choose',
  'Checks their websites for usable contact details',
  'Filters weak signals before they reach you',
  'Gives you leads you can actually use',
]

const differentiation = [
  'Live results, not recycled databases',
  'Contacts pulled from actual business websites',
  'Weak or generic data filtered out',
  'Built for usable leads, not just volume',
]

export default function HomePage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_82%_18%,rgba(45,212,191,0.12),transparent_24%)]" />
      <div className="pointer-events-none absolute left-[-7rem] top-[10rem] h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6rem] top-[34rem] h-80 w-80 rounded-full bg-teal-400/10 blur-3xl" />

      <PublicHeader />

      <section className="relative px-4 pb-16 pt-10 sm:px-6 lg:px-10 lg:pb-20 lg:pt-12">
        <div className="mx-auto grid w-full max-w-7xl gap-14 lg:grid-cols-[minmax(0,1.02fr)_minmax(380px,0.98fr)] lg:items-center">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-300">
              Premium lead engine
            </div>

            <h1 className="mt-8 max-w-5xl text-[2.9rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-[4.5rem] lg:text-[5.6rem]">
              While you&apos;re searching for leads...
              <span className="mt-3 block text-slate-400">
                you&apos;re not closing anything.
              </span>
            </h1>

            <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              ALPA finds real prospects for you in minutes.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
              Generate dozens of real prospects in minutes - not hours of searching.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <FreshStartCta
                className="inline-flex min-h-[58px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-7 text-base font-semibold text-slate-950 shadow-[0_22px_60px_rgba(34,211,238,0.28)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_70px_rgba(34,211,238,0.34)]"
              >
                Get 25 leads
              </FreshStartCta>
              <div className="text-sm text-slate-500">No signup. No setup.</div>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[34rem]">
            <div className="landing-orbit absolute left-[8%] top-[4%] h-24 w-24 rounded-full border border-cyan-400/20 bg-cyan-400/5 blur-[2px]" />
            <div className="landing-orbit absolute bottom-[16%] right-[6%] h-20 w-20 rounded-full border border-teal-300/20 bg-teal-300/5 blur-[2px]" />

            <div className="relative rounded-[34px] border border-white/10 bg-white/[0.03] p-4 shadow-[0_30px_120px_rgba(2,8,23,0.7)] backdrop-blur-2xl sm:p-5">
              <div className="absolute inset-0 rounded-[34px] bg-[linear-gradient(180deg,rgba(34,211,238,0.08),transparent_20%,transparent_78%,rgba(45,212,191,0.08))]" />
              <div className="relative min-h-[36rem] overflow-hidden rounded-[28px] border border-white/8 bg-[#06101f] p-4 sm:min-h-[40rem] sm:p-5">
                <div className="max-w-[21rem] sm:max-w-[22rem]">
                  <LiveLogPanel />
                </div>
                <FloatingLeadShowcase />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <h2 className="text-3xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">
              You&apos;re not bad at outreach.
              <span className="mt-2 block text-slate-400">
                You&apos;re wasting time finding people worth contacting.
              </span>
            </h2>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5 shadow-[0_20px_70px_rgba(2,8,23,0.42)] sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="text-lg font-semibold tracking-[-0.03em] text-white">Manual prospecting</div>
                <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Slow
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                {comparisonPain.map((item) => (
                  <div
                    key={item}
                    className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4"
                  >
                    <span className="text-sm text-slate-300">{item}</span>
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-300/70 shadow-[0_0_12px_rgba(251,113,133,0.45)]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[30px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(15,23,42,0.72))] p-5 shadow-[0_20px_80px_rgba(8,145,178,0.18)] sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="text-lg font-semibold tracking-[-0.03em] text-white">ALPA by MINDRA</div>
                <div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
                  Productive
                </div>
              </div>

              <div className="mt-6 rounded-[24px] border border-white/8 bg-slate-950/60 p-4">
                <div className="grid gap-3">
                  {comparisonWin.map((item) => (
                    <div
                      key={item}
                      className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3"
                    >
                      <span className="text-sm text-slate-200">{item}</span>
                      <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-cyan-300 to-teal-300 shadow-[0_0_14px_rgba(34,211,238,0.7)]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2 lg:items-start">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
              How ALPA works
            </h2>
            <div className="mt-8 grid gap-4">
              {howItWorks.map((item, index) => (
                <div
                  key={item}
                  className="rounded-[24px] border border-white/8 bg-white/[0.03] px-5 py-5 shadow-[0_16px_40px_rgba(2,8,23,0.28)]"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    0{index + 1}
                  </div>
                  <div className="mt-3 text-lg font-medium leading-7 text-slate-200">{item}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-cyan-400/16 bg-[linear-gradient(180deg,rgba(34,211,238,0.07),rgba(255,255,255,0.02))] p-6 shadow-[0_20px_80px_rgba(2,8,23,0.42)] lg:min-h-full">
            <div className="text-2xl font-semibold tracking-[-0.03em] text-white">
              Built for usable leads
            </div>
            <div className="mt-6 space-y-3">
              {differentiation.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/8 bg-slate-950/55 px-4 py-4"
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-r from-cyan-300 to-teal-300 shadow-[0_0_14px_rgba(34,211,238,0.75)]" />
                  <span className="text-sm leading-6 text-slate-200">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-5xl text-center">
          <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(34,211,238,0.03))] px-6 py-12 shadow-[0_24px_80px_rgba(2,8,23,0.52)] sm:px-10 sm:py-16">
            <h2 className="text-3xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">
              Prospecting feeds your pipeline.
              <span className="mt-2 block text-slate-300">Closing grows your business.</span>
              <span className="mt-5 block text-slate-400">Doing both all day slows everything down.</span>
              <span className="mt-5 block text-cyan-200">ALPA handles the first part. You focus on the second.</span>
            </h2>
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-20 pt-8 sm:px-6 lg:px-10 lg:pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="overflow-hidden rounded-[34px] border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(8,47,73,0.94))] p-6 shadow-[0_30px_120px_rgba(6,182,212,0.16)] sm:p-10">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                Try ALPA free
              </h2>
              <p className="mt-4 text-lg leading-8 text-cyan-50/80">
                Run your first search and see how quickly your next conversations appear.
              </p>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <FreshStartCta
                className="inline-flex min-h-[58px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-7 text-base font-semibold text-slate-950 shadow-[0_22px_60px_rgba(34,211,238,0.28)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_70px_rgba(34,211,238,0.34)]"
              >
                Get 25 leads
              </FreshStartCta>
              <Link
                href="/login"
                className="text-sm font-medium text-cyan-100 underline-offset-4 transition hover:text-white hover:underline"
              >
                Returning user? Log in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
