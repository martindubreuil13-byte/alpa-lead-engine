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
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  const parseWithAI = async (text: string): Promise<ParsedBriefing> => {
    try {
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
      console.error('[briefing] AI parsing failed:', err)
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

      // Check for low confidence (missing fields)
      if (result.confidence < 0.7 || !result.offering || !result.audience) {
        // Ask for clarification instead of showing broken summary
        setParsed(result)
        setShowConfirmation(false)
      } else {
        // High confidence - show immediately
        setParsed(result)
        setShowConfirmation(true)
      }
    } finally {
      setIsAnalyzing(false)
    }
  }

  if (!parsed) {
    return (
      <div className="space-y-12 max-w-3xl">
        <div className="space-y-6">
          <h1 className="text-4xl font-semibold text-white leading-tight">
            What would you like to accomplish today?
          </h1>
          <p className="text-base text-slate-400 leading-relaxed">
            Describe your commercial goal. I'll identify the right businesses and prepare today's outreach.
          </p>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              handleSubmit()
            }
          }}
          placeholder="Example: I help early-stage tech companies build stronger sales processes. I want to reach founders who are raising Series A and haven't yet built out dedicated sales teams."
          className="w-full h-32 px-0 py-0 bg-transparent border-b border-slate-600 text-white placeholder-slate-500 focus:border-slate-400 focus:outline-none transition resize-none text-base leading-relaxed"
          disabled={isAnalyzing}
        />

        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isAnalyzing}
          className="px-6 py-3 rounded-lg bg-violet-500 text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition hover:bg-violet-600"
        >
          {isAnalyzing ? 'Understanding your business…' : 'Continue'}
        </button>
      </div>
    )
  }

  // If asking for clarification
  if (!showConfirmation) {
    return (
      <div className="space-y-12 max-w-3xl">
        <div className="space-y-6">
          <div>
            <p className="text-sm text-slate-400 mb-4">Here's what I understand:</p>
            <h2 className="text-2xl font-semibold text-white leading-tight">
              {parsed.offering && parsed.audience
                ? `You're helping ${parsed.audience} with ${parsed.offering}.`
                : "I think I understand your business, but I'd like to confirm something."}
            </h2>
          </div>

          {!parsed.offering && (
            <div className="space-y-3 pt-4">
              <p className="text-sm text-slate-400">What specifically are you offering?</p>
              <input
                type="text"
                placeholder="Your service or product"
                defaultValue={parsed.offering}
                onChange={(e) => setParsed({ ...parsed, offering: e.target.value })}
                className="w-full px-0 py-2 bg-transparent border-b border-slate-600 text-white placeholder-slate-500 focus:border-slate-400 focus:outline-none"
              />
            </div>
          )}

          {!parsed.audience && (
            <div className="space-y-3 pt-4">
              <p className="text-sm text-slate-400">Who are you trying to reach?</p>
              <input
                type="text"
                placeholder="Your ideal customer"
                defaultValue={parsed.audience}
                onChange={(e) => setParsed({ ...parsed, audience: e.target.value })}
                className="w-full px-0 py-2 bg-transparent border-b border-slate-600 text-white placeholder-slate-500 focus:border-slate-400 focus:outline-none"
              />
            </div>
          )}
        </div>

        <button
          onClick={() => setShowConfirmation(true)}
          className="px-6 py-3 rounded-lg bg-violet-500 text-white font-medium text-sm transition hover:bg-violet-600"
        >
          Confirm
        </button>
      </div>
    )
  }

  // Confirmation with commercial insight
  return (
    <div className="space-y-12 max-w-3xl">
      <div className="space-y-6">
        <p className="text-sm text-slate-400">I understand your business.</p>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-white leading-tight">
            You're helping {parsed.audience} with {parsed.offering}.
          </h2>
          {parsed.goal && (
            <p className="text-base text-slate-300">
              Your objective is to {parsed.goal}.
            </p>
          )}
        </div>

        <div className="border-t border-slate-700 pt-6">
          <p className="text-sm text-slate-400 mb-3">My commercial strategy:</p>
          <p className="text-base text-slate-200 leading-relaxed">
            I'll prioritize businesses most likely to benefit from what you're offering. That usually means
            companies that are early enough to benefit, established enough to make decisions, and actively
            growing. Quality conversations beat mass outreach.
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => {
            setParsed(null)
            setShowConfirmation(false)
          }}
          className="px-6 py-3 rounded-lg border border-slate-600 text-slate-300 font-medium text-sm transition hover:bg-slate-900"
        >
          Revise
        </button>
        <button
          onClick={() => onNext(parsed.offering, parsed.audience, parsed.goal)}
          className="px-6 py-3 rounded-lg bg-violet-500 text-white font-medium text-sm transition hover:bg-violet-600"
        >
          Search your library
        </button>
      </div>
    </div>
  )
}
