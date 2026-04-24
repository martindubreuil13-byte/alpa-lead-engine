export async function safeFetch(
  url: string,
  options: RequestInit = {},
  config?: { timeout?: number }
) {
  const timeoutMs = config?.timeout ?? 8000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    console.log('[SAFE FETCH]', url)

    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text()
      const isExpected404 =
        res.status === 404 &&
        text.includes('MISSION_NOT_FOUND')

      if (isExpected404) {
        console.log('[FETCH EXPECTED 404]', url, res.status, text)
      } else {
        console.error('[FETCH ERROR]', url, res.status, text)
      }

      const error = new Error(`HTTP ${res.status}`)
      ;(error as Error & { status?: number; body?: string; expected?: boolean }).status = res.status
      ;(error as Error & { status?: number; body?: string; expected?: boolean }).body = text
      ;(error as Error & { status?: number; body?: string; expected?: boolean }).expected = isExpected404
      throw error
    }

    return res
  } catch (err: any) {
    clearTimeout(timeout)

    if (err?.name === 'AbortError' || err?.message === 'Request timeout') {
      console.warn('[FETCH TIMEOUT - SAFE IGNORE]', url)
      return new Response(JSON.stringify({ timeout: true }), { status: 200 })
    }

    console.error('[FETCH FAILED]', url, err?.message || err)
    throw err
  }
}
