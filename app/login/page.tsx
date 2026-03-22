'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
      />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.6 5.7A10.7 10.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.7 16.7 0 0 1-3 3.8"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.6 6.7A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.7 0 3.2-.5 4.5-1.2"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9"
      />
    </svg>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const router = useRouter()

  async function handleAuth() {
    if (isSignup) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) return alert(error.message)
      alert('Account created. You can log in.')
      setIsSignup(false)
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return alert(error.message)
      router.push('/dashboard')
    }
  }

  function switchMode(nextIsSignup: boolean) {
    setIsSignup(nextIsSignup)
    setShowPassword(false)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050816] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_26%),linear-gradient(180deg,_#030712_0%,_#08111f_45%,_#0b1220_100%)]" />
      <div className="absolute left-1/2 top-12 h-56 w-56 -translate-x-1/2 rounded-full bg-cyan-300/10 blur-3xl" />
      <div className="absolute -left-8 top-1/3 h-64 w-64 rounded-full bg-sky-400/[0.05] blur-3xl" />
      <div className="absolute -right-12 bottom-0 h-72 w-72 rounded-full bg-blue-500/[0.08] blur-3xl" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-[980px]">
          <div className="overflow-hidden rounded-[30px] border border-white/[0.12] bg-white/[0.07] shadow-[0_30px_80px_rgba(2,8,23,0.62)] backdrop-blur-2xl">
            <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
              <section className="border-b border-white/[0.08] px-5 py-6 sm:px-8 sm:py-8 lg:border-b-0 lg:border-r lg:px-10 lg:py-12">
                <div className="inline-flex items-center rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-200">
                  ALPA
                </div>

                <div className="mt-6 max-w-md">
                  <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-white sm:text-[2.6rem]">
                    {isSignup ? 'Create your ALPA access' : 'Access your lead engine'}
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-[15px]">
                    {isSignup
                      ? 'Set up your workspace access and start building pipeline faster.'
                      : 'Pick up where your pipeline left off.'}
                  </p>
                </div>

                <div className="mt-8 hidden gap-4 rounded-[24px] border border-white/[0.08] bg-black/[0.18] p-5 lg:grid">
                  <div className="text-sm font-medium text-slate-200">Built for focused outbound teams</div>
                  <div className="grid gap-3 text-sm text-slate-400">
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                      Find, qualify, and move through leads without losing context.
                    </div>
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                      Keep research, notes, and momentum inside one workflow.
                    </div>
                  </div>
                </div>
              </section>

              <section className="bg-black/[0.16] px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-12">
                <div className="mx-auto w-full max-w-[440px]">
                  <div className="mb-6">
                    <h2 className="text-xl font-semibold tracking-tight text-white">
                      {isSignup ? 'Create account' : 'Log in'}
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                      {isSignup
                        ? 'Use your work email to get started.'
                        : 'Use the email attached to your ALPA workspace.'}
                    </p>
                  </div>

                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void handleAuth()
                    }}
                  >
                    <div className="space-y-2">
                      <label
                        htmlFor="email"
                        className="block text-sm font-medium text-slate-200"
                      >
                        Email
                      </label>
                      <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        className="h-12 w-full rounded-2xl border border-white/[0.12] bg-white/[0.08] px-4 text-[15px] text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/20 sm:h-14"
                        placeholder="name@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <label
                          htmlFor="password"
                          className="block text-sm font-medium text-slate-200"
                        >
                          Password
                        </label>
                        {!isSignup && (
                          <button
                            type="button"
                            onClick={() => alert('Forgot password flow later')}
                            className="shrink-0 text-sm font-medium text-slate-300 transition hover:text-white"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>

                      <div className="relative">
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete={isSignup ? 'new-password' : 'current-password'}
                          className="h-12 w-full rounded-2xl border border-white/[0.12] bg-white/[0.08] px-4 pr-28 text-[15px] text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/20 sm:h-14"
                          placeholder={isSignup ? 'Create a strong password' : 'Enter your password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />

                        <button
                          type="button"
                          onClick={() => setShowPassword((current) => !current)}
                          className="absolute right-1 top-1 flex h-10 min-w-[96px] items-center justify-center gap-2 rounded-xl border border-white/[0.10] bg-white/[0.10] px-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.15] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          aria-pressed={showPassword}
                        >
                          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                          <span>{showPassword ? 'Hide' : 'Show'}</span>
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="flex min-h-[54px] w-full items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.92),rgba(37,99,235,0.95))] px-4 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.28)] transition hover:scale-[0.995] hover:shadow-[0_22px_45px_rgba(14,165,233,0.34)] focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
                    >
                      {isSignup ? 'Create account' : 'Enter ALPA'}
                    </button>
                  </form>

                  <div className="mt-5 text-center text-sm text-slate-400">
                    {isSignup ? 'Already have an account?' : 'New to ALPA?'}{' '}
                    <button
                      type="button"
                      onClick={() => switchMode(!isSignup)}
                      className="font-medium text-cyan-200 transition hover:text-white"
                    >
                      {isSignup ? 'Back to login' : 'Create account'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
