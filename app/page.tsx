import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050816] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_30%),linear-gradient(180deg,_#030712_0%,_#08111f_50%,_#0b1220_100%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="w-full max-w-3xl">
          <div className="mx-auto max-w-2xl rounded-[30px] border border-white/[0.12] bg-white/[0.06] p-8 shadow-[0_30px_80px_rgba(2,8,23,0.62)] backdrop-blur-2xl sm:p-12">
            <div className="inline-flex items-center rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-200">
              ALPA
            </div>

            <div className="mt-8 space-y-5">
              <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                Find your next clients in seconds.
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                Find, enrich, and act on business leads in seconds.
              </p>
            </div>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.92),rgba(37,99,235,0.95))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.24)]"
              >
                Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
