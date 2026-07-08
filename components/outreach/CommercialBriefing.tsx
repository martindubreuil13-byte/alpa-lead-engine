import { useState } from 'react'
import { ArrowRight } from 'lucide-react'

interface CommercialBriefingProps {
  onNext: (offering: string, audience: string, goal: string) => void
  initialOffering?: string
  initialAudience?: string
  initialGoal?: string
}

export function CommercialBriefing({
  onNext,
  initialOffering = '',
  initialAudience = '',
  initialGoal = '',
}: CommercialBriefingProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [offering, setOffering] = useState(initialOffering)
  const [audience, setAudience] = useState(initialAudience)
  const [goal, setGoal] = useState(initialGoal)

  const handleNext = () => {
    if (step === 1 && offering.trim().length < 10) return
    if (step === 2 && audience.trim().length < 10) return
    if (step === 3 && !goal) {
      onNext(offering, audience, goal)
      return
    }
    setStep((s) => (s === 3 ? 3 : (s + 1) as 1 | 2 | 3))
  }

  const handleBack = () => {
    setStep((s) => (s === 1 ? 1 : (s - 1) as 1 | 2 | 3))
  }

  const isStepValid = () => {
    if (step === 1) return offering.trim().length >= 10
    if (step === 2) return audience.trim().length >= 10
    if (step === 3) return goal.length > 0
    return false
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Let's prepare your outreach today.</h2>
        <p className="mt-2 text-sm text-slate-400">Answer a few quick questions and we'll find the right businesses to reach.</p>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex-1 h-1 rounded-full transition ${
              s <= step
                ? s === step
                  ? 'bg-violet-500'
                  : 'bg-violet-500/40'
                : 'bg-white/10'
            }`}
          />
        ))}
      </div>

      {/* Step 1: Offering */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">
              What are you offering today?
            </label>
            <input
              type="text"
              value={offering}
              onChange={(e) => setOffering(e.target.value)}
              placeholder="e.g., AI Coaching, Website Design, SEO Services"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-violet-400/50 focus:bg-white/8"
              autoFocus
            />
            {offering.length < 10 && (
              <p className="mt-2 text-xs text-slate-500">
                {offering.length}/10 characters minimum
              </p>
            )}
          </div>

          {/* Example chips */}
          <div className="flex flex-wrap gap-2">
            {['AI Coaching', 'Website Design', 'SEO Services', 'Accounting', 'Business Consulting'].map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setOffering(example)}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 transition hover:bg-white/5 hover:text-slate-300"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Audience */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">
              Who would benefit most from it?
            </label>
            <textarea
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g., Marketing agencies with 10-50 employees, Technology companies looking to automate..."
              rows={4}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-violet-400/50 focus:bg-white/8 resize-none"
              autoFocus
            />
            {audience.length < 10 && (
              <p className="mt-2 text-xs text-slate-500">
                {audience.length}/10 characters minimum
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Goal */}
      {step === 3 && (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-300 mb-4">
            If someone receives your message, what would you like them to do?
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { value: 'book_meeting', label: '📅 Book a meeting', icon: '📅' },
              { value: 'request_quote', label: '📋 Request quotation', icon: '📋' },
              { value: 'visit_website', label: '🌐 Visit website', icon: '🌐' },
              { value: 'schedule_demo', label: '🎬 Schedule demo', icon: '🎬' },
              { value: 'reply', label: '💬 Reply to message', icon: '💬' },
              { value: 'call', label: '📞 Call me', icon: '📞' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setGoal(option.value)}
                className={`p-4 rounded-xl border transition text-left ${
                  goal === option.value
                    ? 'border-violet-400/50 bg-violet-500/10'
                    : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                }`}
              >
                <div className="font-medium text-white">{option.label}</div>
              </button>
            ))}
          </div>

          {/* Custom goal option */}
          {goal === 'custom' && (
            <input
              type="text"
              placeholder="Describe your goal..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 outline-none transition focus:border-violet-400/50 focus:bg-white/8"
            />
          )}

          <p className="text-xs text-slate-500">This becomes your campaign goal.</p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={handleBack}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            Back
          </button>
        )}

        <button
          type="button"
          onClick={handleNext}
          disabled={!isStepValid()}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {step === 3 ? 'Find Businesses' : 'Next'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
