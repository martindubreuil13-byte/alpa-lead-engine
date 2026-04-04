'use client'

import { sendGAEvent } from '@next/third-parties/google'

export const trackEvent = (event: string, params?: Record<string, any>) => {
  sendGAEvent('event', event, params || {})
}
