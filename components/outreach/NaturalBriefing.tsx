'use client'

import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'

interface NaturalBriefingProps {
  onNext: (offering: string, audience: string, goal: string) => void
}

export function NaturalBriefing({ onNext }: NaturalBriefingProps) {
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<{
    offering: string
    audience: string
    goal: string
  } | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  const parseInput = (text: string) => {
    // Simple deterministic parsing to feel intelligent
    const lowerText = text.toLowerCase()

    // Extract offering
    const offeringMatch = text.match(/(?:offer|promote|sell|provide|have|use|show|share)[:\s]+([^.]+?)(?:\.|to|for|reach|target|connect|that|which)/i)
    const offering = offeringMatch ? offeringMatch[1].trim() : ''

    // Extract audience
    const audienceMatch = text.match(/(?:reach|target|to|for|looking for|connect with|contact)[:\s]+([^.]+?)(?:\.|who|that|interested|struggling|want|need)/i)
    const audience = audienceMatch ? audienceMatch[1].trim() : ''

    // Extract goal
    const goalMatch = text.match(/(?:want|goal|objective|aim|hoping|trying|looking)[:\s]+([^.]+?)(?:\.|so|because|to improve|to help|because)/i)
    const goal = goalMatch ? goalMatch[1].trim() : ''

    return { offering, audience, goal }
  }

  const handleSubmit = () => {
    if (!input.trim()) return
    const result = parseInput(input)
    setParsed(result)
  }

  if (!parsed) {
    return (
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-white mb-3">
            What are you trying to promote today?
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                handleSubmit()
              }
            }}
            placeholder="Example: I want to help business coaches find more clients. I have an AI prospecting tool that makes outreach easier."
            className="w-full h-32 px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30 transition resize-none"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="w-full px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 disabled:opacity-50 disabled:cursor-not-allowed transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Continue
        </button>

        <p className="text-xs text-slate-500 text-center">
          Just describe what you're accomplishing. I'll extract the details.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-400 mb-6">
          Here's what I understood:
        </p>

        {/* Confident Recommendation Presentation */}
        {!isEditing && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-6">
              <p className="text-base leading-relaxed text-white">
                You're promoting <span className="font-semibold text-violet-200">{parsed.offering || '(not specified)'}</span> to <span className="font-semibold text-violet-200">{parsed.audience || '(not specified)'}</span>.
              </p>
              {parsed.goal && (
                <p className="text-base leading-relaxed text-white mt-3">
                  Your goal is <span className="font-semibold text-violet-200">{parsed.goal}</span>.
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setIsEditing(true)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
              >
                Edit
              </button>
              <button
                onClick={() => onNext(parsed.offering, parsed.audience, parsed.goal)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
              >
                That's right, continue
              </button>
            </div>
          </div>
        )}

        {/* Edit Mode */}
        {isEditing && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                What you're promoting
              </label>
              <input
                type="text"
                value={parsed.offering}
                onChange={(e) => setParsed({ ...parsed, offering: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                Who you're reaching
              </label>
              <input
                type="text"
                value={parsed.audience}
                onChange={(e) => setParsed({ ...parsed, audience: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                Your goal
              </label>
              <input
                type="text"
                value={parsed.goal}
                onChange={(e) => setParsed({ ...parsed, goal: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setIsEditing(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
              >
                Back
              </button>
              <button
                onClick={() => {
                  setIsEditing(false)
                  onNext(parsed.offering, parsed.audience, parsed.goal)
                }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
