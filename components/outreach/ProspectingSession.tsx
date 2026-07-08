'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { NaturalBriefing } from './NaturalBriefing'
import { RepositorySearch } from './RepositorySearch'
import { RepositoryResults } from './RepositoryResults'
import { RefinementOptions, type RefinementFilters } from './RefinementOptions'
import { CampaignBrief } from './CampaignBrief'

type Step = 'natural_briefing' | 'searching' | 'results' | 'optional_refinement' | 'brief'
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
  showRefinement: boolean
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
  showRefinement: false,
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

  // Handle results - go directly to brief (no refinement step)
  // Optional refinement can be accessed separately if needed
  const handleResultsNext = () => {
    updateState({ step: 'brief' })
  }

  // Handle optional refinement toggle
  const handleToggleRefinement = () => {
    updateState({ showRefinement: !state.showRefinement })
  }

  // Handle filter changes
  const handleFiltersChange = (filters: RefinementFilters) => {
    updateState({ filters })
  }

  // Handle refinement completion (go back to results)
  const handleRefinementNext = (filters: RefinementFilters) => {
    updateState({
      filters,
      showRefinement: false,
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
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          {state.step === 'natural_briefing' && 'Prepare Today's Outreach'}
          {state.step === 'searching' && 'Searching Your Library'}
          {state.step === 'results' && 'Your Matching Businesses'}
          {state.step === 'brief' && 'Campaign Brief'}
        </h2>
        {state.step !== 'natural_briefing' && state.step !== 'searching' && (
          <button
            type="button"
            onClick={handleBack}
            className="p-2 rounded-lg text-slate-400 hover:bg-white/5 hover:text-white transition"
            title="Go back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8">
        {state.step === 'natural_briefing' && (
          <NaturalBriefing onNext={handleBriefingComplete} />
        )}

        {state.step === 'searching' && (
          <RepositorySearch
            offering={state.offering}
            audience={state.audience}
            goal={state.goal}
            onResults={handleSearchResults}
          />
        )}

        {state.step === 'results' && (
          <div className="space-y-6">
            <RepositoryResults
              totalMatches={state.totalMatches}
              matchesWithCI={state.matchesWithCI}
              matchesWithoutCI={state.matchesWithoutCI}
              onNext={handleResultsNext}
            />

            {/* Optional refinement link */}
            <div className="border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={handleToggleRefinement}
                className="text-xs text-slate-400 hover:text-slate-300 transition"
              >
                {state.showRefinement ? '↓ Hide refinement options' : '↑ Show refinement options'}
              </button>
            </div>

            {state.showRefinement && (
              <div className="border-t border-white/10 pt-6">
                <RefinementOptions
                  totalMatches={state.filteredCount}
                  onFiltersChange={handleFiltersChange}
                  onNext={handleRefinementNext}
                />
              </div>
            )}
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
