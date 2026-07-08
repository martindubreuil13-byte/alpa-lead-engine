'use client'

import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { supabase } from '@/lib/supabase'

interface RepositorySearchAnimatedProps {
  offering: string
  audience: string
  goal: string
  onResults: (results: {
    totalMatches: number
    matchesWithCI: number
    matchesWithoutCI: number
  }) => void
}

const PROGRESS_STEPS = [
  'Understanding your offer…',
  'Finding businesses…',
  'Reviewing your library…',
  'Ranking opportunities…',
  'Selecting today\'s recommendations…',
]

export function RepositorySearchAnimated({
  offering,
  audience,
  goal,
  onResults,
}: RepositorySearchAnimatedProps) {
  const { user } = useCurrentUser()
  const [currentStep, setCurrentStep] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  // Animate through progress steps
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= PROGRESS_STEPS.length - 1) {
          return prev
        }
        return prev + 1
      })
    }, 400)

    return () => clearInterval(interval)
  }, [])

  // Perform actual search
  useEffect(() => {
    if (!user || !offering.trim() || !audience.trim() || !goal) return

    const performSearch = async () => {
      try {
        // Query My Leads repository for businesses matching the audience
        const { data, error, count } = await supabase
          .from('leads')
          .select('id, commercial_intelligence_version', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .neq('ci_status', 'failed')
          .order('updated_at', { ascending: false })

        if (!error && count !== null) {
          // Count with CI data
          const { count: ciCount, error: ciError } = await supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('ci_status', 'completed')

          const totalMatches = count
          const matchesWithCI = ciError ? 0 : ciCount || 0
          const matchesWithoutCI = totalMatches - matchesWithCI

          // Wait for animation to complete before showing results
          setTimeout(() => {
            setIsComplete(true)
            onResults({
              totalMatches,
              matchesWithCI,
              matchesWithoutCI,
            })
          }, 1500)
        }
      } catch (err) {
        console.error('[search] Error:', err)
        setIsComplete(true)
        onResults({
          totalMatches: 0,
          matchesWithCI: 0,
          matchesWithoutCI: 0,
        })
      }
    }

    const timer = setTimeout(performSearch, 800)
    return () => clearTimeout(timer)
  }, [user, offering, audience, goal, onResults])

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-6">
      {/* Animated Progress Indicator */}
      <div className="flex gap-1">
        {PROGRESS_STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-all duration-300 ${
              i <= currentStep ? 'w-8 bg-violet-400' : 'w-2 bg-slate-600'
            }`}
          />
        ))}
      </div>

      {/* Current Step Text */}
      <div className="h-8 text-center">
        <p className="text-sm text-slate-300 animate-pulse">
          {PROGRESS_STEPS[currentStep]}
        </p>
      </div>

      {/* Completion Message */}
      {isComplete && (
        <div className="text-center">
          <p className="text-sm text-violet-300">Done.</p>
        </div>
      )}
    </div>
  )
}
