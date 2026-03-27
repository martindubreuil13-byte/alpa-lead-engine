export interface EmailDataFilterInput {
  isValid: boolean
  confidence: 'high' | 'medium' | 'low' | null
}

export interface LeadFilterResult {
  keep: boolean
  reason: 'invalid_email' | 'low_confidence' | 'valid'
}

export function isLowConfidence(confidence: EmailDataFilterInput['confidence']): boolean {
  return confidence === 'low' || confidence === null
}

export function shouldKeepLead(emailData: EmailDataFilterInput): LeadFilterResult {
  if (!emailData.isValid) {
    return { keep: false, reason: 'invalid_email' }
  }

  if (isLowConfidence(emailData.confidence)) {
    return { keep: false, reason: 'low_confidence' }
  }

  return { keep: true, reason: 'valid' }
}
