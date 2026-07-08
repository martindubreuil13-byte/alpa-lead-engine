'use client'

import { useState } from 'react'

interface NaturalBriefingProps {
  onNext: (offering: string, audience: string, goal: string) => void
}

interface ParsedBriefing {
  offering: string
  audience: string
  goal: string
  confidence: number
}

export function NaturalBriefing({ onNext }: NaturalBriefingProps) {
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<ParsedBriefing | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const parseWithAI = async (text: string): Promise<ParsedBriefing> => {
    try {
      // Call Claude Haiku to extract commercial intent naturally
      const response = await fetch('/api/outreach/parse-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text }),
      })

      if (!response.ok) {
        throw new Error('AI parsing failed')
      }

      const data = await response.json()
      return data as ParsedBriefing
    } catch (err) {
      console.error('[briefing] AI parsing failed, using fallback:', err)
      // Fallback to deterministic parsing
      return parseWithFallback(text)
    }
  }

  const parseWithFallback = (text: string): ParsedBriefing => {
    const lowerText = text.toLowerCase()

    const offeringMatch = text.match(
      /(?:offer|promote|sell|provide|have|use|show|share|help|service)[:\s]+([^.]+?)(?:\.|to|for|reach|target|connect|that|which)/i
    )
    const offering = offeringMatch ? offeringMatch[1].trim() : ''

    const audienceMatch = text.match(
      /(?:reach|target|to|for|looking for|connect with|contact|help)[:\s]+([^.]+?)(?:\.|who|that|interested|struggling|want|need)/i
    )
    const audience = audienceMatch ? audienceMatch[1].trim() : ''

    const goalMatch = text.match(
      /(?:want|goal|objective|aim|hoping|trying|looking)[:\s]+([^.]+?)(?:\.|so|because|to improve|to help|because)/i
    )
    const goal = goalMatch ? goalMatch[1].trim() : ''

    return {
      offering: offering || '',
      audience: audience || '',
      goal: goal || '',
      confidence: 0.6,
    }
  }

  const handleSubmit = async () => {
    if (!input.trim()) return
    setIsAnalyzing(true)

    try {
      const result = await parseWithAI(input)
      setParsed(result)
    } finally {
      setIsAnalyzing(false)
    }
  }

  if (!parsed) {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Good afternoon.</p>
          <label className="block text-lg font-medium text-white">
            What would you like to accomplish today?
          </label>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              handleSubmit()
            }
          }}
          placeholder="Describe what you're working on. I'll understand the details…"
          className="w-full h-40 px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/30 transition resize-none text-base leading-relaxed"
          disabled={isAnalyzing}
        />

        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isAnalyzing}
          className="w-full px-4 py-3 rounded-lg border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 disabled:opacity-50 disabled:cursor-not-allowed transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          {isAnalyzing ? 'Analyzing…' : 'Continue'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Here's what I understand:</p>
      </div>

      {/* Confident Recommendation Presentation */}
      {!isEditing && (
        <div className="space-y-6">
          <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-8 space-y-4">
            <p className="text-lg leading-relaxed text-white">
              You're introducing{' '}
              <span className="font-semibold text-violet-200">{parsed.offering}</span> to{' '}
              <span className="font-semibold text-violet-200">{parsed.audience}</span>.
            </p>
            {parsed.goal && (
              <p className="text-lg leading-relaxed text-white">
                Your goal is to{' '}
                <span className="font-semibold text-violet-200">{parsed.goal}</span>.
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 px-4 py-3 rounded-lg border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              Adjust
            </button>
            <button
              onClick={() => onNext(parsed.offering, parsed.audience, parsed.goal)}
              className="flex-1 px-4 py-3 rounded-lg border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
            >
              Yes, continue
            </button>
          </div>
        </div>
      )}

      {/* Edit Mode */}
      {isEditing && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              What you're offering
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
              className="flex-1 px-4 py-3 rounded-lg border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              Back
            </button>
            <button
              onClick={() => {
                setIsEditing(false)
                onNext(parsed.offering, parsed.audience, parsed.goal)
              }}
              className="flex-1 px-4 py-3 rounded-lg border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
