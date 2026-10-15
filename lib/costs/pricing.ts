// What each provider call is estimated to cost. These are configured prices, not invoices: ESTIMATES that the monthly reconciliation
// compares with what was actually billed. Nothing here calls a provider.
//
// To change a price: edit the value below and bump PRICING_AS_OF. Events record the estimate that applied when they happened, so
// a change affects only later requests; earlier estimates are never rewritten.

export const PRICING_AS_OF = '2026-10-16'

export type Provider = 'serper' | 'google_places' | 'openai'
export type Operation = 'maps_search' | 'text_search' | 'place_details' | 'chat_completion'

// ---- Serper (prepaid credits) ---------------------------------------------------------------------------------------------------
/** Credit packages bought, newest last. The rate in force is the latest one. Add a package here when more credits are purchased. */
export const SERPER_PACKAGES = [
  { label: '50,000 credits for $50 (before tax)', credits: 50_000, priceUsd: 50, boughtOn: '2026-10-01' },
] as const

/** Credits one request consumes, per operation. An operation not listed here is NOT assumed to cost anything: its credits are unknown. */
export const SERPER_CREDITS_PER_OPERATION: Partial<Record<Operation, number>> = {
  maps_search: 3,
}

export const serperUsdPerCredit = (packages: readonly { credits: number; priceUsd: number }[] = SERPER_PACKAGES) => {
  const latest = packages[packages.length - 1]
  return latest.priceUsd / latest.credits
}

/** Credits a Serper request is configured to consume; null when the operation is not configured. */
export const serperConfiguredCredits = (operation: Operation) => SERPER_CREDITS_PER_OPERATION[operation] ?? null

/** Null when the credits are unknown: the request is still recorded, its cost is not invented. */
export const serperCostOf = (credits: number | null) => (credits === null ? null : round6(credits * serperUsdPerCredit()))

// ---- Google Places (Legacy) -----------------------------------------------------------------------------------------------------
/** Published list price per billing event, before any free monthly allowance. */
export const GOOGLE_SKU_USD = {
  text_search: 0.032, // Places - Text Search (Legacy)
  place_details: 0.017, // Places - Place Details (Legacy)
  contact_data: 0.003, // phone number, website
  atmosphere_data: 0.005, // rating, reviews
  basic_data: 0, // name, address, types
} as const
export type GoogleSku = keyof typeof GOOGLE_SKU_USD

/**
 * One Text Search (Legacy) request is billed under the Text Search SKU and ALSO under Basic, Contact and Atmosphere Data, because its
 * response always carries every field. Those are billing EVENTS of a single HTTP request, not further requests.
 */
export const GOOGLE_TEXT_SEARCH_SKUS: GoogleSku[] = ['text_search', 'basic_data', 'contact_data', 'atmosphere_data']

const CONTACT_FIELDS = new Set(['formatted_phone_number', 'international_phone_number', 'website', 'opening_hours', 'current_opening_hours'])
const ATMOSPHERE_FIELDS = new Set(['rating', 'user_ratings_total', 'reviews', 'price_level', 'serves_beer', 'serves_wine'])

/** The billing events one Place Details request generates, from the fields it asks for. */
export function googleDetailsSkus(fields: string): GoogleSku[] {
  const asked = fields.split(',').map((field) => field.trim()).filter(Boolean)
  const skus: GoogleSku[] = ['place_details', 'basic_data']
  if (asked.some((field) => CONTACT_FIELDS.has(field))) skus.push('contact_data')
  if (asked.some((field) => ATMOSPHERE_FIELDS.has(field))) skus.push('atmosphere_data')
  return skus
}

export function googleCostOf(skus: readonly GoogleSku[]) {
  return round6(skus.reduce((sum, sku) => sum + GOOGLE_SKU_USD[sku], 0))
}

// ---- OpenAI ---------------------------------------------------------------------------------------------------------------------
/** USD per million tokens. */
export const OPENAI_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
}

/** Null when the model has no known price: the tokens are still recorded, the cost is not invented. */
export function openAiCostOf(model: string, inputTokens: number, outputTokens: number) {
  const price = OPENAI_USD_PER_MILLION[model] ?? OPENAI_USD_PER_MILLION[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')]
  if (!price) return null
  return round6((inputTokens * price.input + outputTokens * price.output) / 1_000_000)
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6
}
