'use client'

import { useState } from 'react'

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
    // Simple deterministic parsing (no AI, just pattern matching)
    const lowerText = text.toLowerCase()

    // Extract offering (what they're promoting)
    const offeringMatch = text.match(/(?:offer|promote|sell|provide|service|product|tool|platform)[:\s]+([^.]+?)(?:\.|to|for|reach|target|connect|that|which)/i)
    const offering = offeringMatch ? offeringMatch[1].trim() : ''

    // Extract audience (who they're reaching)
    const audienceMatch = text.match(/(?:reach|target|promote to|connect with|contact|sell to|looking for)[:\s]+([^.]+?)(?:\.|who|that|interested|struggling|want|need)/i)
    const audience = audienceMatch ? audienceMatch[1].trim() : ''

    // Extract goal/action (what they want to achieve)
    const goalMatch = text.match(/(?:want|goal|objective|aim|looking|trying|hoping)[:\s]+([^.]+?)(?:\.|so|because|to improve|to help)/i)
    const goal = goalMatch ? goalMatch[1].trim() : ''

    return { offering, audience, goal }
  }

  const handleParse = () => {
    if (!input.trim()) return
    const result = parseInput(input)
    setParsed(result)
    setIsEditing(true)
  }

  const handleConfirm = () => {
    if (parsed && (parsed.offering || parsed.audience || parsed.goal)) {
      onNext(parsed.offering, parsed.audience, parsed.goal)
    }
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
            placeholder="Example: I want to reach business coaches who are struggling with client acquisition. I have an AI prospecting tool that could help them..."
            className="w-full h-32 px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30 transition resize-none"
          />
        </div>

        <button
          onClick={handleParse}
          disabled={!input.trim()}
          className="w-full px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 disabled:opacity-50 disabled:cursor-not-allowed transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Continue
        </button>

        <p className="text-xs text-slate-500">
          Just describe what you're trying to accomplish. We'll extract the details you can edit next.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-white mb-4">
          Got it. Let me make sure I understand:
        </p>

        <div className="space-y-4">
          {/* Offering */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              What you're offering
            </label>
            {isEditing ? (
              <input
                type="text"
                value={parsed.offering}
                onChange={(e) =>
                  setParsed({ ...parsed, offering: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30"
              />
            ) : (
              <p className="text-white text-sm">{parsed.offering || '(not specified)'}</p>
            )}
          </div>

          {/* Audience */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Your best-fit audience
            </label>
            {isEditing ? (
              <input
                type="text"
                value={parsed.audience}
                onChange={(e) =>
                  setParsed({ ...parsed, audience: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30"
              />
            ) : (
              <p className="text-white text-sm">{parsed.audience || '(not specified)'}</p>
            )}
          </div>

          {/* Goal */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Desired action
            </label>
            {isEditing ? (
              <input
                type="text"
                value={parsed.goal}
                onChange={(e) =>
                  setParsed({ ...parsed, goal: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30"
              />
            ) : (
              <p className="text-white text-sm">{parsed.goal || '(not specified)'}</p>
            )}
          </div>
        </div>
      </div>

      {isEditing && (
        <button
          onClick={() => setIsEditing(false)}
          className="text-xs text-slate-400 hover:text-slate-300 transition"
        >
          Done editing
        </button>
      )}

      {!isEditing && (
        <button
          onClick={() => setIsEditing(true)}
          className="text-xs text-slate-400 hover:text-slate-300 transition"
        >
          Edit
        </button>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => setParsed(null)}
          className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-300"
        >
          Back
        </button>
        <button
          onClick={handleConfirm}
          className="flex-1 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Search for matches
        </button>
      </div>
    </div>
  )
}
