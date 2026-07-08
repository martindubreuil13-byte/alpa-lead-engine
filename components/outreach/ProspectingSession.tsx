'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { NaturalBriefing } from './NaturalBriefing'
import { RepositorySearchAnimated } from './RepositorySearchAnimated'
import { RepositoryResults } from './RepositoryResults'
import { RefinementOptions, type RefinementFilters } from './RefinementOptions'
import { CampaignBrief } from './CampaignBrief'

type Step = 'natural_briefing' | 'searching' | 'results' | 'refinement' | 'brief'
type AutomationLevel = 'manual' | 'personalize' | 'generate'

interface ProspectingSessionState {
  step: Step
  offering: string
  audience: string
  goal: string
  totalMatches: number
  matchesWithCI: number
  matchesWithoutCI: number
  filters: RefinementFilters
  filteredCount: number
  capacity: number
  automationLevel: AutomationLevel
}

const SESSION_KEY = 'prospecting_session'
const INITIAL_STATE: ProspectingSessionState = {
  step: 'natural_briefing',
  offering: '',
  audience: '',
  goal: '',
  totalMatches: 0,
  matchesWithCI: 0,
  matchesWithoutCI: 0,
  filters: {},
  filteredCount: 0,
  capacity: 20,
  automationLevel: 'personalize',
}

interface ProspectingSessionProps {
  onComplete?: (session: ProspectingSessionState) => void
  onCancel?: () => void
}

export function ProspectingSession({
  onComplete,
  onCancel,
}: ProspectingSessionProps) {
  const [state, setState] = useState<ProspectingSessionState>(INITIAL_STATE)
  const [showSearch, setShowSearch] = useState(false)

  // Load from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) {
      try {
        setState(JSON.parse(saved))
      } catch (e) {
        console.error('[preparation] Failed to load session:', e)
      }
    }
  }, [])

  // Persist to sessionStorage whenever state changes
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state))
  }, [state])

  const updateState = (updates: Partial<ProspectingSessionState>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }

  // Handle natural briefing completion - trigger search
  const handleBriefingComplete = (offering: string, audience: string, goal: string) => {
    updateState({
      offering,
      audience,
      goal,
      step: 'searching',
    })
    setShowSearch(true)
  }

  // Handle search results
  const handleSearchResults = (results: {
    totalMatches: number
    matchesWithCI: number
    matchesWithoutCI: number
  }) => {
    updateState({
      ...results,
      filteredCount: results.totalMatches,
      capacity: Math.min(20, results.totalMatches),
      step: 'results',
    })
    setShowSearch(false)
  }

  // Handle results - user can either use recommendation or adjust
  const handleResultsNext = () => {
    updateState({ step: 'brief' })
  }

  const handleResultsAdjust = () => {
    updateState({ step: 'refinement' })
  }

  // Handle filter changes
  const handleFiltersChange = (filters: RefinementFilters) => {
    updateState({ filters })
  }

  // Handle refinement completion - go to brief
  const handleRefinementNext = (filters: RefinementFilters) => {
    updateState({
      filters,
      step: 'brief',
    })
  }

  // Handle campaign brief confirmation
  const handleBriefNext = () => {
    if (onComplete) {
      onComplete(state)
    }
  }

  // Handle back navigation
  const handleBack = () => {
    switch (state.step) {
      case 'results':
        updateState({ step: 'natural_briefing' })
        break
      case 'refinement':
        updateState({ step: 'results' })
        break
      case 'brief':
        updateState({ step: 'results' })
        break
    }
  }

  // Auto-trigger search when in searching state
  useEffect(() => {
    if (state.step === 'searching' && !showSearch) {
      setShowSearch(true)
    }
  }, [state.step])

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Back button */}
      {state.step !== 'natural_briefing' && state.step !== 'searching' && (
        <button
          type="button"
          onClick={handleBack}
          className="p-2 rounded-lg text-slate-400 hover:bg-white/5 hover:text-white transition -ml-2"
          title="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      {/* Content */}
      <div>
        {state.step === 'natural_briefing' && (
          <NaturalBriefing onNext={handleBriefingComplete} />
        )}

        {state.step === 'searching' && (
          <RepositorySearchAnimated
            offering={state.offering}
            audience={state.audience}
            goal={state.goal}
            onResults={handleSearchResults}
          />
        )}

        {state.step === 'results' && (
          <RepositoryResults
            totalMatches={state.totalMatches}
            matchesWithCI={state.matchesWithCI}
            matchesWithoutCI={state.matchesWithoutCI}
            onNext={handleResultsNext}
            onAdjust={handleResultsAdjust}
          />
        )}

        {state.step === 'refinement' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-slate-400 mb-6">
                Fine-tune your selection:
              </p>
            </div>
            <RefinementOptions
              totalMatches={state.filteredCount || state.totalMatches}
              onFiltersChange={handleFiltersChange}
              onNext={handleRefinementNext}
            />
          </div>
        )}

        {state.step === 'brief' && (
          <CampaignBrief
            offering={state.offering}
            audience={state.audience}
            goal={state.goal}
            totalMatches={state.totalMatches}
            selectedCapacity={state.capacity}
            automationLevel={state.automationLevel}
            onNext={handleBriefNext}
            onBack={handleBack}
          />
        )}
      </div>

      {/* Cancel button */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full px-4 py-2 rounded-lg text-xs text-slate-500 transition hover:text-slate-400 hover:bg-white/5"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
