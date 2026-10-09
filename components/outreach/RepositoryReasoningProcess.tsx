'use client'

import { useEffect, useRef, useState } from 'react'

interface ReasoningStep {
  label: string
  value: number
  description: string
  completed: boolean
}

interface RepositoryReasoningProcessProps {
  offering: string
  audience: string
  goal: string
  onComplete: (results: {
    totalMatches: number
    matchesWithCI: number
    matchesWithoutCI: number
  }) => void
}

export function RepositoryReasoningProcess({
  offering,
  audience,
  goal,
  onComplete,
}: RepositoryReasoningProcessProps) {
  const hasStarted = useRef(false)
  const [steps, setSteps] = useState<ReasoningStep[]>([
    {
      label: 'Businesses reviewed',
      value: 0,
      description: 'Starting with the businesses already available to reach',
      completed: false,
    },
    {
      label: 'Ready for judgment',
      value: 0,
      description: 'Businesses with enough commercial context to evaluate',
      completed: false,
    },
    {
      label: 'Strong candidates',
      value: 0,
      description: 'Matches with clear relevance to your offer and audience',
      completed: false,
    },
    {
      label: 'Recommended for today',
      value: 0,
      description: 'A focused starting group for personalized outreach',
      completed: false,
    },
  ])

  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    // Simulate the reasoning process with realistic numbers
    const sequence = async () => {
      // Step 1: Total count
      await new Promise((resolve) => setTimeout(resolve, 800))
      setSteps((prev) => {
        const updated = [...prev]
        updated[0].value = 3142
        updated[0].completed = true
        return updated
      })
      setCurrentStep(1)

      // Step 2: With CI
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setSteps((prev) => {
        const updated = [...prev]
        updated[1].value = 1028
        updated[1].completed = true
        return updated
      })
      setCurrentStep(2)

      // Step 3: Strong fit
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setSteps((prev) => {
        const updated = [...prev]
        updated[2].value = 386
        updated[2].completed = true
        return updated
      })
      setCurrentStep(3)

      // Step 4: Recommendation
      await new Promise((resolve) => setTimeout(resolve, 800))
      setSteps((prev) => {
        const updated = [...prev]
        updated[3].value = 20
        updated[3].completed = true
        return updated
      })
      setCurrentStep(4)

      // Complete
      await new Promise((resolve) => setTimeout(resolve, 400))
      onComplete({
        totalMatches: 3142,
        matchesWithCI: 1028,
        matchesWithoutCI: 3142 - 1028,
      })
    }

    sequence()
  }, [onComplete])

  return (
    <div className="space-y-12 max-w-3xl">
      <div className="space-y-6">
        <p className="text-sm text-slate-400">Evaluating commercial opportunities...</p>

        <div className="space-y-3">
          <h2 className="text-2xl font-semibold leading-tight text-white">
            Based on what you're selling, I'll prioritize businesses that look mature enough to buy, but still early enough to benefit.
          </h2>
          <p className="text-base leading-7 text-slate-300">
            I am looking for fit with {offering}, relevance to {audience}, and enough commercial context to prepare a specific first message.
          </p>
          {goal ? (
            <p className="text-sm leading-6 text-slate-400">
              The outreach will be judged against one practical outcome: {goal}.
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`transition-all duration-300 ${
                index <= currentStep ? 'opacity-100' : 'opacity-30'
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${
                    step.completed ? 'bg-violet-400' : 'bg-slate-600'
                  }`}
                />
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="text-base font-medium text-white">{step.label}</p>
                    {step.value > 0 && (
                      <p className="text-lg font-semibold text-violet-300">
                        {step.value.toLocaleString()}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{step.description}</p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div className="ml-1 my-3 h-6 w-0.5 bg-gradient-to-b from-slate-600 to-transparent" />
              )}
            </div>
          ))}
        </div>
      </div>

      {currentStep === 4 && (
        <div className="border-t border-slate-700 pt-6">
          <p className="text-sm text-slate-300">
            Search complete. Recommendations ready.
          </p>
        </div>
      )}
    </div>
  )
}
