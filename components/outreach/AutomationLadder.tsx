import { Check } from 'lucide-react'

type AutomationLevel = 'manual' | 'personalize' | 'generate'

interface AutomationLadderProps {
  value: AutomationLevel
  onChange: (level: AutomationLevel) => void
}

export function AutomationLadder({ value, onChange }: AutomationLadderProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-1">
          How would you like to prepare your outreach?
        </h3>
        <p className="text-xs text-slate-500">
          Choose your level of automation. You review everything before sending.
        </p>
      </div>

      <div className="grid gap-3">
        {/* Option 1: Manual */}
        <button
          type="button"
          onClick={() => onChange('manual')}
          className={`p-4 rounded-xl border text-left transition ${
            value === 'manual'
              ? 'border-violet-400/50 bg-violet-500/10'
              : 'border-white/10 hover:border-white/20 hover:bg-white/5'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium text-white">I'll prepare everything myself</div>
              <div className="mt-1 text-xs text-slate-400">
                You stay in control. ALPA personalizes contact info only.
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                <span>📊 Effort: You do the work</span>
                <span>⚡ Speed: Slower</span>
              </div>
            </div>
            {value === 'manual' && (
              <Check className="h-5 w-5 text-violet-300 shrink-0 mt-0.5" />
            )}
          </div>
        </button>

        {/* Option 2: Personalize */}
        <button
          type="button"
          onClick={() => onChange('personalize')}
          className={`p-4 rounded-xl border text-left transition ${
            value === 'personalize'
              ? 'border-violet-400/50 bg-violet-500/10'
              : 'border-white/10 hover:border-white/20 hover:bg-white/5'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium text-white">AI helps me personalize</div>
              <div className="mt-1 text-xs text-slate-400">
                You write a message. ALPA adapts it for each business.
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                <span>📊 Effort: Balanced</span>
                <span>⚡ Speed: Faster</span>
              </div>
            </div>
            {value === 'personalize' && (
              <Check className="h-5 w-5 text-violet-300 shrink-0 mt-0.5" />
            )}
          </div>
        </button>

        {/* Option 3: Generate */}
        <button
          type="button"
          onClick={() => onChange('generate')}
          className={`p-4 rounded-xl border text-left transition ${
            value === 'generate'
              ? 'border-violet-400/50 bg-violet-500/10'
              : 'border-white/10 hover:border-white/20 hover:bg-white/5'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium text-white">AI prepares everything for review</div>
              <div className="mt-1 text-xs text-slate-400">
                ALPA writes personalized messages for each business. You review.
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                <span>📊 Effort: Minimal</span>
                <span>⚡ Speed: Fastest</span>
              </div>
            </div>
            {value === 'generate' && (
              <Check className="h-5 w-5 text-violet-300 shrink-0 mt-0.5" />
            )}
          </div>
        </button>
      </div>

      <div className="p-3 rounded-lg border border-slate-700/50 bg-slate-900/20">
        <p className="text-xs text-slate-400">
          💡 Regardless of your choice, you review and approve everything before it's sent.
        </p>
      </div>
    </div>
  )
}
