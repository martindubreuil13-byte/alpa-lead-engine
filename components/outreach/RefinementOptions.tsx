import { useState } from 'react'
import { ChevronDown, ArrowRight } from 'lucide-react'

interface RefinementOptionsProps {
  totalMatches: number
  onFiltersChange: (filters: RefinementFilters) => void
  onNext: (filters: RefinementFilters) => void
}

export interface RefinementFilters {
  industry?: string[]
  location?: string[]
  size?: string[]
  ciSignals?: string[]
}

const INDUSTRIES = [
  'Technology',
  'Healthcare',
  'Finance',
  'Retail',
  'Manufacturing',
  'Real Estate',
  'Professional Services',
  'Media',
  'Education',
]

const LOCATIONS = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'France',
  'Remote',
]

export function RefinementOptions({
  totalMatches,
  onFiltersChange,
  onNext,
}: RefinementOptionsProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [filters, setFilters] = useState<RefinementFilters>({})

  const handleToggleIndustry = (industry: string) => {
    const currentIndustries = filters.industry || []
    const updated = {
      ...filters,
      industry: currentIndustries.includes(industry)
        ? currentIndustries.filter((i) => i !== industry)
        : [...currentIndustries, industry],
    }
    setFilters(updated)
    onFiltersChange(updated)
  }

  const handleToggleLocation = (location: string) => {
    const currentLocations = filters.location || []
    const updated = {
      ...filters,
      location: currentLocations.includes(location)
        ? currentLocations.filter((l) => l !== location)
        : [...currentLocations, location],
    }
    setFilters(updated)
    onFiltersChange(updated)
  }

  const handleToggleSize = (size: string) => {
    const currentSizes = filters.size || []
    const updated = {
      ...filters,
      size: currentSizes.includes(size)
        ? currentSizes.filter((s) => s !== size)
        : [...currentSizes, size],
    }
    setFilters(updated)
    onFiltersChange(updated)
  }

  const handleToggleCISignal = (signal: string) => {
    const currentSignals = filters.ciSignals || []
    const updated = {
      ...filters,
      ciSignals: currentSignals.includes(signal)
        ? currentSignals.filter((s) => s !== signal)
        : [...currentSignals, signal],
    }
    setFilters(updated)
    onFiltersChange(updated)
  }

  const hasActiveFilters =
    (filters.industry?.length ?? 0) > 0 ||
    (filters.location?.length ?? 0) > 0 ||
    (filters.size?.length ?? 0) > 0 ||
    (filters.ciSignals?.length ?? 0) > 0

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-4">
          Refine your selection (optional)
        </h3>
        <p className="text-xs text-slate-500">
          All filters are optional. Skip any you don't need.
        </p>
      </div>

      {/* Industry Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() =>
            setExpandedSection(expandedSection === 'industry' ? null : 'industry')
          }
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition text-left"
        >
          <span className="text-sm font-medium text-white">Industry</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition ${
              expandedSection === 'industry' ? 'rotate-180' : ''
            }`}
          />
        </button>
        {expandedSection === 'industry' && (
          <div className="px-3 py-3 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
            {INDUSTRIES.map((industry) => (
              <label key={industry} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(filters.industry || []).includes(industry)}
                  onChange={() => handleToggleIndustry(industry)}
                  className="h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-violet-500"
                />
                <span className="text-sm text-slate-300">{industry}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Location Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() =>
            setExpandedSection(expandedSection === 'location' ? null : 'location')
          }
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition text-left"
        >
          <span className="text-sm font-medium text-white">Location</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition ${
              expandedSection === 'location' ? 'rotate-180' : ''
            }`}
          />
        </button>
        {expandedSection === 'location' && (
          <div className="px-3 py-3 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
            {LOCATIONS.map((location) => (
              <label key={location} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(filters.location || []).includes(location)}
                  onChange={() => handleToggleLocation(location)}
                  className="h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-violet-500"
                />
                <span className="text-sm text-slate-300">{location}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Company Size Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() =>
            setExpandedSection(expandedSection === 'size' ? null : 'size')
          }
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition text-left"
        >
          <span className="text-sm font-medium text-white">Company Size</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition ${
              expandedSection === 'size' ? 'rotate-180' : ''
            }`}
          />
        </button>
        {expandedSection === 'size' && (
          <div className="px-3 py-3 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
            {['Startup', 'Small', 'Mid-market', 'Enterprise'].map((size) => (
              <label key={size} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(filters.size || []).includes(size)}
                  onChange={() => handleToggleSize(size)}
                  className="h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-violet-500"
                />
                <span className="text-sm text-slate-300">{size}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* CI Signals Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() =>
            setExpandedSection(expandedSection === 'ci' ? null : 'ci')
          }
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition text-left"
        >
          <span className="text-sm font-medium text-white">Commercial Intelligence</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition ${
              expandedSection === 'ci' ? 'rotate-180' : ''
            }`}
          />
        </button>
        {expandedSection === 'ci' && (
          <div className="px-3 py-3 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
            {['Has CI Data', 'High Confidence (8+)', 'Any business'].map((signal) => (
              <label key={signal} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(filters.ciSignals || []).includes(signal)}
                  onChange={() => handleToggleCISignal(signal)}
                  className="h-4 w-4 rounded border-white/20 bg-white/[0.04] accent-violet-500"
                />
                <span className="text-sm text-slate-300">{signal}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="space-y-3 pt-4 border-t border-white/10">
        <button
          type="button"
          onClick={() => onNext(filters)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Continue to Selection
          <ArrowRight className="h-4 w-4" />
        </button>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setFilters({})
              onFiltersChange({})
            }}
            className="w-full px-4 py-2 rounded-lg text-xs text-slate-400 transition hover:text-slate-300 hover:bg-white/5"
          >
            Clear all filters
          </button>
        )}
      </div>
    </div>
  )
}
