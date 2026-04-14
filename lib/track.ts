'use client'

export async function trackEvent(event: string, data: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const session_id =
      window.localStorage.getItem('session_id') || window.crypto.randomUUID()
    window.localStorage.setItem('session_id', session_id)

    console.log('📡 TRACK EVENT:', event, data)

    const response = await fetch('/api/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event,
        session_id,
        ...data,
      }),
    })

    if (!response.ok) {
      console.error('❌ TRACK FAILED:', new Error(`Track API responded with ${response.status}`))
    }
  } catch (err) {
    console.error('❌ TRACK FAILED:', err)
  }
}
