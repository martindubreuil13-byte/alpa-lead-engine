import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'ALPA by MINDRA'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'stretch',
          background:
            'linear-gradient(135deg, #020617 0%, #0f172a 42%, #0f3b69 72%, #164e63 100%)',
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'space-between',
          padding: '64px',
          width: '100%',
        }}
      >
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '999px',
            color: '#bae6fd',
            display: 'flex',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            padding: '14px 24px',
            width: 'fit-content',
          }}
        >
          ALPA by MINDRA
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, maxWidth: '920px' }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: '-0.05em',
              lineHeight: 1.02,
            }}
          >
            Lead Generation
            <br />
            and Prospecting
          </div>

          <div
            style={{
              color: '#cbd5e1',
              fontSize: 34,
              lineHeight: 1.35,
              maxWidth: '900px',
            }}
          >
            Find and access verified business contacts faster with a modern sales prospecting tool.
          </div>
        </div>
      </div>
    ),
    size
  )
}
