import { openai } from '@/lib/ai/openai'
import type { CommercialProfile, ExtractionResult, WebsiteSnapshot, BusinessSignals } from './types'

const MODEL = 'gpt-4o-mini'
const MAX_TOKENS = 500

export async function generateCommercialProfile(
  website: string | null | undefined,
  snapshot: WebsiteSnapshot | null | undefined,
  signals: BusinessSignals | null | undefined
): Promise<ExtractionResult<CommercialProfile>> {
  const startTime = Date.now()

  if (!website) {
    return {
      ok: false,
      error: { code: 'NO_WEBSITE', message: 'Website URL is required' },
      duration_ms: 0,
      cost: 0.00015,
    }
  }

  if (!snapshot || !signals) {
    return {
      ok: false,
      error: {
        code: 'MISSING_DATA',
        message: 'Website Snapshot and Business Signals required',
      },
      duration_ms: 0,
      cost: 0.00015,
    }
  }

  // Check if OpenAI API key is available
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'OpenAI API key not configured',
      },
      duration_ms: 0,
      cost: 0,
    }
  }

  try {
    const prompt = buildPrompt(website, snapshot, signals)

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a business analyst. Extract factual information from website data and generate a brief commercial profile. Be concise and factual. Do not speculate. Do not include confidence scores or hedging language.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Low temperature for factual output
      max_tokens: MAX_TOKENS,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      return {
        ok: false,
        error: { code: 'EMPTY_RESPONSE', message: 'No response from API' },
        duration_ms: Date.now() - startTime,
        cost: estimateTokenCost(0, completion.usage?.completion_tokens || 0),
      }
    }

    const profile = parseProfileResponse(content)

    // Estimate cost: GPT-4o mini pricing
    // Input: $0.15 per 1M tokens
    // Output: $0.60 per 1M tokens
    const inputTokens = completion.usage?.prompt_tokens || 0
    const outputTokens = completion.usage?.completion_tokens || 0
    const cost = (inputTokens * 0.00000015 + outputTokens * 0.0000006) || 0.0001

    return {
      ok: true,
      data: profile,
      duration_ms: Date.now() - startTime,
      cost,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    // Check if it's a rate limit or API error
    let cost = 0.0001 // Estimate failed call cost
    if (errorMessage.includes('rate') || errorMessage.includes('quota')) {
      cost = 0.0005
    }

    return {
      ok: false,
      error: {
        code: 'API_ERROR',
        message: errorMessage,
      },
      duration_ms: Date.now() - startTime,
      cost,
    }
  }
}

function buildPrompt(
  website: string,
  snapshot: WebsiteSnapshot,
  signals: BusinessSignals
): string {
  return `
Website: ${website}

Title: ${snapshot.title || 'N/A'}
Meta Description: ${snapshot.meta_description || 'N/A'}
H1: ${snapshot.h1 || 'N/A'}
Body Excerpt: ${snapshot.body_excerpt ? snapshot.body_excerpt.slice(0, 200) : 'N/A'}

Features Detected:
- Has Contact Page: ${signals.has_contact_page}
- Has About Page: ${signals.has_about_page}
- Has Services Page: ${signals.has_services_page}
- Has Pricing: ${signals.has_pricing}
- Has Blog: ${signals.has_blog}
- Has Testimonials: ${signals.has_testimonials}
- Has FAQ: ${signals.has_faq}
- Detected CMS: ${signals.detected_cms || 'Unknown'}
- Detected E-commerce Platform: ${signals.detected_ecommerce_platform || 'No'}

Social Links: ${
    Object.entries(signals.has_social_links ? { linkedin: true, twitter: true } : {})
      .filter(([_, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'None detected'
  }

Based on this information, generate a factual commercial profile with these fields (JSON format):

{
  "summary": "1-2 sentence factual summary of what the business does",
  "industry": "Industry category (e.g., Software Development)",
  "business_category": "Type (e.g., B2B SaaS, Agency, E-commerce)",
  "primary_service": "Main service offering",
  "core_services": ["service1", "service2", "service3"],
  "target_customer": "Who they serve (e.g., Small businesses, Enterprises)",
  "competitive_advantage": "Key differentiator or strength",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

Rules:
- Be factual and concise
- Base everything on the website data provided
- Do not speculate or invent information
- If uncertain, use what's visible on the site
- Return only valid JSON, no other text
`.trim()
}

function parseProfileResponse(content: string): CommercialProfile {
  try {
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      summary: String(parsed.summary || '').slice(0, 500),
      industry: String(parsed.industry || '').slice(0, 100),
      business_category: String(parsed.business_category || '').slice(0, 100),
      primary_service: String(parsed.primary_service || '').slice(0, 200),
      core_services: Array.isArray(parsed.core_services) ? parsed.core_services.slice(0, 5) : [],
      target_customer: String(parsed.target_customer || '').slice(0, 200),
      competitive_advantage: String(parsed.competitive_advantage || '').slice(0, 300),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 10) : [],
      generated_at: new Date().toISOString(),
    }
  } catch {
    // Return minimal profile if parsing fails
    return {
      summary: 'Unable to generate profile',
      industry: 'Unknown',
      business_category: 'Unknown',
      primary_service: 'Unknown',
      core_services: [],
      target_customer: 'Unknown',
      competitive_advantage: 'Unknown',
      keywords: [],
      generated_at: new Date().toISOString(),
    }
  }
}

function estimateTokenCost(inputTokens: number, outputTokens: number): number {
  // GPT-4o mini pricing: $0.15 per 1M input tokens, $0.60 per 1M output tokens
  return inputTokens * 0.00000015 + outputTokens * 0.0000006
}
