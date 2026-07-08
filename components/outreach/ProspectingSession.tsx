'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { CommercialBriefing } from './CommercialBriefing'
import { RepositorySearch } from './RepositorySearch'
import { RepositoryResults } from './RepositoryResults'
import { RefinementOptions, type RefinementFilters } from './RefinementOptions'
import { CapacitySelection } from './CapacitySelection'
import { AutomationLadder } from './AutomationLadder'
import { CampaignBrief } from './CampaignBrief'

type Step = 'briefing' | 'searching' | 'results' | 'refinement' | 'capacity' | 'automation' | 'brief'
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
  step: 'briefing',
  offering: '',
  audience: '',
  goal: '',
  totalMatches: 0,
  matchesWithCI: 0,
  matchesWithoutCI: 0,
  filters: {},
  filteredCount: 0,
  capacity: 0,
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

  // Handle briefing completion - trigger search
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

  // Handle moving to refinement or directly to capacity
  const handleResultsNext = () => {
    updateState({ step: 'refinement' })
  }

  // Handle filter changes
  const handleFiltersChange = (filters: RefinementFilters) => {
    // In Phase 1, filters are just stored but not applied to search yet
    // Phase 2+ will implement actual filter application
    updateState({ filters })
  }

  // Handle refinement completion
  const handleRefinementNext = (filters: RefinementFilters) => {
    updateState({
      filters,
      step: 'capacity',
    })
  }

  // Handle capacity selection
  const handleCapacityNext = (capacity: number) => {
    updateState({
      capacity,
      step: 'automation',
    })
  }

  // Handle automation level selection
  const handleAutomationChange = (level: AutomationLevel) => {
    updateState({ automationLevel: level })
  }

  // Handle going to campaign brief
  const handleAutomationNext = () => {
    updateState({ step: 'brief' })
  }

  // Handle campaign brief confirmation
  const handleBriefNext = () => {
    // Campaign Brief confirmed - in Phase 2+, this triggers draft generation
    // For now, just notify parent if needed
    if (onComplete) {
      onComplete(state)
    }
  }

  // Handle back navigation
  const handleBack = () => {
    switch (state.step) {
      case 'results':
        updateState({ step: 'briefing' })
        break
      case 'refinement':
        updateState({ step: 'results' })
        break
      case 'capacity':
        updateState({ step: 'refinement' })
        break
      case 'automation':
        updateState({ step: 'capacity' })
        break
      case 'brief':
        updateState({ step: 'automation' })
        break
    }
  }

  // Trigger live search when briefing changes
  useEffect(() => {
    if (state.offering && state.audience && state.goal && !showSearch) {
      // Auto-trigger search after brief
      if (state.step === 'searching') {
        setShowSearch(true)
      }
    }
  }, [state.offering, state.audience, state.goal])

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">
          {state.step === 'briefing' && 'Commercial Briefing'}
          {state.step === 'searching' && 'Searching Your Library'}
          {state.step === 'results' && 'Your Matching Businesses'}
          {state.step === 'refinement' && 'Refine Your Selection'}
          {state.step === 'capacity' && 'Select Capacity'}
          {state.step === 'automation' && 'Preparation Mode'}
          {state.step === 'brief' && 'Campaign Brief'}
        </h2>
        {state.step !== 'briefing' && state.step !== 'searching' && (
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
        {state.step === 'briefing' && (
          <CommercialBriefing
            onNext={handleBriefingComplete}
            initialOffering={state.offering}
            initialAudience={state.audience}
            initialGoal={state.goal}
          />
        )}

        {state.step === 'searching' && (
          <>
            <RepositorySearch
              offering={state.offering}
              audience={state.audience}
              goal={state.goal}
              onResults={handleSearchResults}
            />
          </>
        )}

        {state.step === 'results' && (
          <RepositoryResults
            totalMatches={state.totalMatches}
            matchesWithCI={state.matchesWithCI}
            matchesWithoutCI={state.matchesWithoutCI}
            onNext={handleResultsNext}
          />
        )}

        {state.step === 'refinement' && (
          <RefinementOptions
            totalMatches={state.filteredCount}
            onFiltersChange={handleFiltersChange}
            onNext={handleRefinementNext}
          />
        )}

        {state.step === 'capacity' && (
          <CapacitySelection
            totalAvailable={state.filteredCount}
            onNext={handleCapacityNext}
          />
        )}

        {state.step === 'automation' && (
          <div className="space-y-6">
            <AutomationLadder
              value={state.automationLevel}
              onChange={handleAutomationChange}
            />
            <button
              type="button"
              onClick={handleAutomationNext}
              className="w-full px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
            >
              Review Brief
            </button>
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
