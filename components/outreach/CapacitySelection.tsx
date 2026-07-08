import { useState } from 'react'
import { ArrowRight } from 'lucide-react'

interface CapacitySelectionProps {
  totalAvailable: number
  onNext: (capacity: number) => void
}

export function CapacitySelection({
  totalAvailable,
  onNext,
}: CapacitySelectionProps) {
  const [capacity, setCapacity] = useState(Math.min(20, totalAvailable))

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCapacity(Math.min(parseInt(e.target.value, 10), totalAvailable))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10)
    if (!isNaN(value)) {
      setCapacity(Math.max(1, Math.min(value, totalAvailable)))
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">
          How many businesses would you like to reach today?
        </h3>
        <p className="text-sm text-slate-400">
          You can always start small and reach out to more later.
        </p>
      </div>

      {/* Display */}
      <div className="flex items-center justify-center gap-2 py-6">
        <input
          type="number"
          value={capacity}
          onChange={handleInputChange}
          min="1"
          max={totalAvailable}
          className="h-16 w-20 text-center text-2xl font-bold bg-white/5 border border-white/10 rounded-lg text-white outline-none focus:border-violet-400/50"
        />
        <span className="text-sm text-slate-400">
          out of {totalAvailable}
        </span>
      </div>

      {/* Slider */}
      <div className="space-y-3">
        <input
          type="range"
          value={capacity}
          onChange={handleSliderChange}
          min="1"
          max={totalAvailable}
          className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-violet-500"
        />
        <div className="flex justify-between text-xs text-slate-500">
          <span>1</span>
          <span>{totalAvailable}</span>
        </div>
      </div>

      {/* Recommendation */}
      <div className="p-3 rounded-lg border border-violet-400/20 bg-violet-500/10">
        <p className="text-xs text-violet-300">
          💡 We recommend starting with 20-30 for your first outreach. You can always adjust.
        </p>
      </div>

      {/* Action */}
      <button
        type="button"
        onClick={() => onNext(capacity)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
      >
        Continue
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  )
}
