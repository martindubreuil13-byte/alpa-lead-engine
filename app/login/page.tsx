'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { clearGuestTrial, getGuestLeads } from '@/lib/guest-session'
import { clearGuestTrialMode } from '@/lib/session/guest-trial-mode'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mode = new URLSearchParams(window.location.search).get('mode')
    setIsSignup(mode === 'signup')
  }, [])

  async function claimGuestTrialIfNeeded() {
    const guestLeads = getGuestLeads()
    if (guestLeads.length === 0) return

    const res = await fetch('/api/guest/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: guestLeads }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || 'Failed to import guest leads')
    }

    clearGuestTrial()
  }

  async function handleAuth() {
    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) return alert(error.message)

      if (data.session) {
        await claimGuestTrialIfNeeded()
        clearGuestTrialMode()
        router.push('/dashboard')
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        alert('Account created. Confirm your email and then log in to import your guest leads.')
        setIsSignup(false)
        return
      }

      await claimGuestTrialIfNeeded()
      clearGuestTrialMode()
      router.push('/dashboard')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return alert(error.message)
      await claimGuestTrialIfNeeded()
      clearGuestTrialMode()
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
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[6px]" />
      <div className="absolute left-1/2 top-12 h-56 w-56 -translate-x-1/2 rounded-full bg-cyan-300/10 blur-3xl" />
      <div className="absolute -left-8 top-1/3 h-64 w-64 rounded-full bg-sky-400/[0.05] blur-3xl" />
      <div className="absolute -right-12 bottom-0 h-72 w-72 rounded-full bg-blue-500/[0.08] blur-3xl" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-[420px]">
          <div className="overflow-hidden rounded-[28px] border border-white/[0.12] bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(8,15,30,0.92))] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.68)] backdrop-blur-2xl sm:p-8">
            <div className="mx-auto mb-8 flex w-fit items-center rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-200">
              ALPA
            </div>

            <div className="space-y-2 text-center">
              <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-white sm:text-[2.2rem]">
                {isSignup ? 'Create your account' : 'Back to building'}
              </h1>
              <p className="text-sm leading-6 text-slate-400 sm:text-[15px]">
                {isSignup
                  ? 'Create your workspace and start finding real opportunities.'
                  : 'Access your leads and continue building your pipeline'}
              </p>
            </div>

            <form
              className="mt-8 space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleAuth()
              }}
            >
              <div>
                <label htmlFor="email" className="sr-only">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="h-14 w-full rounded-2xl border border-white/[0.10] bg-white/[0.06] px-4 text-[15px] text-white placeholder:text-slate-500 transition-all duration-200 focus:border-cyan-300/45 focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-end">
                  {!isSignup && (
                    <button
                      type="button"
                      onClick={() => alert('Forgot password flow later')}
                      className="text-sm font-medium text-slate-400 transition hover:text-white"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>

                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <div className="relative isolate z-[50]">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    className="w-full rounded-xl border border-white/10 bg-[#0B1120] px-4 py-3 pr-12 text-white placeholder:text-gray-500 focus:border-cyan-400/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 transition-all duration-150"
                    placeholder={isSignup ? 'Create a password' : 'Password'}
                    style={{ color: '#ffffff' }}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-3 top-1/2 z-[60] -translate-y-1/2 cursor-pointer text-gray-400 transition-all duration-150 hover:text-white hover:drop-shadow-[0_0_6px_rgba(56,189,248,0.5)] focus:outline-none"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-white" />
                    ) : (
                      <Eye className="h-5 w-5 text-white" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="mt-2 flex min-h-[58px] w-full items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(37,99,235,0.95))] px-4 text-base font-semibold text-slate-950 shadow-[0_20px_50px_rgba(14,165,233,0.28)] transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_28px_64px_rgba(14,165,233,0.38)] focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              >
                {isSignup ? 'Create account' : 'Continue'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-400">
              {isSignup ? 'Already have an account?' : 'New here?'}{' '}
              <button
                type="button"
                onClick={() => switchMode(!isSignup)}
                className="font-medium text-cyan-200 transition hover:text-white"
              >
                {isSignup ? 'Log in' : 'Create account'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
