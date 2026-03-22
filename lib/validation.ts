export type EmailType = "business" | "free" | "corporate" | "system";
export type EmailSource = "website" | "guessed";

export interface EmailValidationResult {
  value: string;
  isValid: boolean;
  type: EmailType;
  confidence: number;
}

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com"
]);

const SYSTEM_DOMAIN_KEYWORDS = ["wix", "sentry", "noreply", "no-reply"] as const;
const CORPORATE_DOMAIN_KEYWORDS = ["marriott", "hilton", "fourseasons"] as const;
const BUSINESS_PREFIX_KEYWORDS = ["info", "contact", "hello", "reservations"] as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getDomain(email: string): string {
  const normalizedEmail = normalizeEmail(email);
  const atIndex = normalizedEmail.lastIndexOf("@");

  if (atIndex === -1) {
    return "";
  }

  return normalizedEmail.slice(atIndex + 1);
}

export function classifyEmail(email: string): EmailType {
  const domain = getDomain(email);

  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return "free";
  }

  if (SYSTEM_DOMAIN_KEYWORDS.some((keyword) => domain.includes(keyword))) {
    return "system";
  }

  if (CORPORATE_DOMAIN_KEYWORDS.some((keyword) => domain.includes(keyword))) {
    return "corporate";
  }

  return "business";
}

export function basicValidation(email: string): boolean {
  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail.length < 6 || !normalizedEmail.includes("@")) {
    return false;
  }

  const domain = getDomain(normalizedEmail);

  return domain.includes(".");
}

export function calculateConfidence(email: string, source: EmailSource): number {
  const normalizedEmail = normalizeEmail(email);
  let confidence = 0;

  confidence += source === "website" ? 0.6 : 0.3;

  if (BUSINESS_PREFIX_KEYWORDS.some((keyword) => normalizedEmail.includes(keyword))) {
    confidence += 0.2;
  }

  return Math.min(confidence, 1);
}

export function validateEmail(
  email: string,
  source: EmailSource
): EmailValidationResult {
  const value = normalizeEmail(email);

  return {
    value,
    isValid: basicValidation(value),
    type: classifyEmail(value),
    confidence: calculateConfidence(value, source)
  };
}
