'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'

export default function KaiaWidget() {
  const [visible, setVisible] = useState(false)
  const [trialFlowActive, setTrialFlowActive] = useState(false)

  useEffect(() => {
    let triggered = false
    const trigger = () => {
      if (!triggered) {
        triggered = true
        setVisible(true)
      }
    }

    const timer = setTimeout(trigger, 5000)
    window.addEventListener('scroll', trigger, { once: true, passive: true })

    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', trigger)
    }
  }, [])

  useEffect(() => {
    const hideForTrialFlow = () => setTrialFlowActive(true)
    const restoreAfterTrialFlow = () => setTrialFlowActive(false)

    window.addEventListener('alpa:trial-flow-active', hideForTrialFlow)
    window.addEventListener('alpa:trial-flow-inactive', restoreAfterTrialFlow)

    return () => {
      window.removeEventListener('alpa:trial-flow-active', hideForTrialFlow)
      window.removeEventListener('alpa:trial-flow-inactive', restoreAfterTrialFlow)
    }
  }, [])

  return (
    <>
      <Script
        src="https://unpkg.com/@elevenlabs/convai-widget-embed"
        strategy="afterInteractive"
        type="text/javascript"
      />
      {visible && !trialFlowActive && (
        <elevenlabs-convai
          agent-id="agent_7501krtex2vvev5artzaeh1azyt3"
        ></elevenlabs-convai>
      )}
    </>
  )
}
