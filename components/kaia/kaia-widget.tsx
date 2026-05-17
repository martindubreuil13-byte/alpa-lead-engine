'use client'

import Script from 'next/script'

export default function KaiaWidget() {
  return (
    <>
      <Script
        src="https://unpkg.com/@elevenlabs/convai-widget-embed"
        strategy="afterInteractive"
        type="text/javascript"
      />

      <elevenlabs-convai agent-id="agent_7501krtex2vvev5artzaeh1azyt3"></elevenlabs-convai>
    </>
  )
}
