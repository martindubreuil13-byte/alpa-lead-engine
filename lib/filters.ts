export interface EmailDataFilterInput {
  isValid: boolean;
  type: string;
  confidence: number;
}

export interface LeadFilterResult {
  keep: boolean;
  reason: "invalid_email" | "system_email" | "low_confidence" | "valid";
}

export function isSystemEmail(emailType: string): boolean {
  return emailType === "system";
}

export function isLowConfidence(confidence: number): boolean {
  return confidence < 0.6;
}

export function isCorporate(type: string): boolean {
  return type === "corporate";
}

export function shouldKeepLead(emailData: EmailDataFilterInput): LeadFilterResult {
  if (!emailData.isValid) {
    return { keep: false, reason: "invalid_email" };
  }

  if (isSystemEmail(emailData.type)) {
    return { keep: false, reason: "system_email" };
  }

  if (isLowConfidence(emailData.confidence)) {
    return { keep: false, reason: "low_confidence" };
  }

  return { keep: true, reason: "valid" };
}
