// What each provider call is estimated to cost. These are LIST PRICES copied from the providers' public pricing pages on
// PRICING_AS_OF; they are estimates, never the provider's invoice. Review them when a provider changes its prices or when
// ALPA moves to a different plan or API version. Nothing here calls a provider.

export const PRICING_AS_OF = '2026-10-16'

export type Provider = 'serper' | 'google_places' | 'openai'
export type Operation = 'maps_search' | 'text_search' | 'place_details' | 'chat_completion'

/** Serper sells prepaid packs: roughly $1.00 per 1,000 credits at the smallest pack down to $0.30 at the largest. A map search is 1 credit. */
export const SERPER_USD_PER_CREDIT = 0.001
export const SERPER_CREDITS_PER_MAPS_SEARCH = 1

/** Google Places (Legacy) list prices per request. Each request is billed once for its base SKU, plus a data SKU per field group asked for. */
export const GOOGLE_SKU_USD = {
  text_search: 0.032, // Places - Text Search (Legacy), $32 per 1,000
  place_details: 0.017, // Places - Place Details (Legacy), $17 per 1,000
  contact_data: 0.003, // Contact Data: phone number, website. $3 per 1,000
  atmosphere_data: 0.005, // Atmosphere Data: rating, reviews. $5 per 1,000
  basic_data: 0, // Basic Data: name, address, types. No charge
} as const
export type GoogleSku = keyof typeof GOOGLE_SKU_USD

/** Free monthly events per SKU, as Google states them. Counted against ALPA's own tracked calls only. */
export const GOOGLE_FREE_MONTHLY_EVENTS: Partial<Record<GoogleSku, number>> = {
  text_search: 5000,
  place_details: 5000,
  contact_data: 1000,
}

/** Place Details field groups. The fields ALPA requests decide which data SKUs a request generates. */
const CONTACT_FIELDS = new Set(['formatted_phone_number', 'international_phone_number', 'website', 'opening_hours', 'current_opening_hours'])
const ATMOSPHERE_FIELDS = new Set(['rating', 'user_ratings_total', 'reviews', 'price_level', 'serves_beer', 'serves_wine'])

export function googleDetailsSkus(fields: string): GoogleSku[] {
  const asked = fields.split(',').map((field) => field.trim()).filter(Boolean)
  const skus: GoogleSku[] = ['place_details']
  if (asked.some((field) => CONTACT_FIELDS.has(field))) skus.push('contact_data')
  if (asked.some((field) => ATMOSPHERE_FIELDS.has(field))) skus.push('atmosphere_data')
  return skus
}

export function googleCostOf(skus: readonly GoogleSku[]) {
  return round6(skus.reduce((sum, sku) => sum + GOOGLE_SKU_USD[sku], 0))
}

/** OpenAI list prices in USD per million tokens. */
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

export const serperCostOf = (credits: number) => round6(credits * SERPER_USD_PER_CREDIT)

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6
}
