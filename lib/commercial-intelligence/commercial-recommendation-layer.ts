/**
 * Commercial Recommendation Layer
 *
 * Lightweight reasoning engine that improves search recommendations.
 * Combines deterministic rules + optional LLM reasoning.
 * Always produces one actionable recommendation.
 * Never blocks the workflow.
 */

export interface CommercialRecommendation {
  advice: string
  priorityField: string | null
  priorityValue: string | null
  confidence: number
}

type IndustryRule = {
  keywords: string[]
  advice: string
  priorityField: string | null
  priorityValue: string | null
}

// Deterministic industry rules
const INDUSTRY_RULES: IndustryRule[] = [
  {
    keywords: ['seo', 'search engine', 'google ranking'],
    advice: 'Businesses with established websites respond better. I\'ll prioritize companies with online presence.',
    priorityField: 'has_website',
    priorityValue: 'true',
  },
  {
    keywords: ['website', 'web design', 'web development'],
    advice: 'Outdated websites generate strong interest. I\'ll start with businesses needing updates.',
    priorityField: 'website_quality',
    priorityValue: 'outdated',
  },
  {
    keywords: ['business coach', 'coaching', 'executive coach'],
    advice: 'Established businesses with revenue respond best. I\'ll prioritize companies beyond early stage.',
    priorityField: 'company_stage',
    priorityValue: 'established',
  },
  {
    keywords: ['ai consulting', 'ai implementation', 'artificial intelligence'],
    advice: 'Larger companies with existing operations are better targets. I\'ll focus there first.',
    priorityField: 'company_size',
    priorityValue: 'mid_to_large',
  },
  {
    keywords: ['accounting', 'bookkeeping', 'tax', 'cpa'],
    advice: 'Growing businesses are most responsive. I\'ll target companies in growth phase.',
    priorityField: 'company_stage',
    priorityValue: 'growth',
  },
  {
    keywords: ['marketing', 'content marketing', 'social media'],
    advice: 'Companies with marketing teams tend to be ready. I\'ll prioritize those.',
    priorityField: 'has_marketing_team',
    priorityValue: 'true',
  },
  {
    keywords: ['legal', 'law firm', 'attorney', 'lawyer'],
    advice: 'Established law practices respond well. I\'ll start with professionals, not solo practitioners.',
    priorityField: 'company_size',
    priorityValue: 'mid_to_large',
  },
  {
    keywords: ['recruitment', 'staffing', 'hiring', 'talent'],
    advice: 'Active hiring companies are most receptive. I\'ll prioritize businesses growing.',
    priorityField: 'company_stage',
    priorityValue: 'growth',
  },
  {
    keywords: ['manufacturing', 'industrial', 'supply chain'],
    advice: 'Established manufacturers with existing operations are ideal. I\'ll focus there.',
    priorityField: 'company_stage',
    priorityValue: 'established',
  },
  {
    keywords: ['restaurant', 'food', 'hospitality', 'cafe'],
    advice: 'Independent operators are more responsive than large chains. I\'ll prioritize those.',
    priorityField: 'company_type',
    priorityValue: 'independent',
  },
  {
    keywords: ['consulting', 'consultant'],
    advice: 'Established consulting firms respond well. I\'ll prioritize those first.',
    priorityField: 'company_stage',
    priorityValue: 'established',
  },
  {
    keywords: ['software', 'saas', 'app development', 'platform'],
    advice: 'Companies actively developing are most interested. I\'ll target growth-stage businesses.',
    priorityField: 'company_stage',
    priorityValue: 'growth',
  },
  {
    keywords: ['medical', 'healthcare', 'clinic', 'practice'],
    advice: 'Multi-provider practices are more receptive. I\'ll focus on those.',
    priorityField: 'company_size',
    priorityValue: 'mid_to_large',
  },
  {
    keywords: ['financial', 'wealth', 'investment', 'advisory'],
    advice: 'Established advisory practices are ideal. I\'ll prioritize those.',
    priorityField: 'company_stage',
    priorityValue: 'established',
  },
  {
    keywords: ['ecommerce', 'retail', 'shop', 'store'],
    advice: 'Online retailers with active sales are most responsive. I\'ll prioritize active operations.',
    priorityField: 'has_active_operations',
    priorityValue: 'true',
  },
]

function matchIndustryRule(
  offering: string,
  audience: string
): IndustryRule | null {
  const combined = `${offering} ${audience}`.toLowerCase()

  for (const rule of INDUSTRY_RULES) {
    for (const keyword of rule.keywords) {
      if (combined.includes(keyword.toLowerCase())) {
        return rule
      }
    }
  }

  return null
}

function getGenericRecommendation(): CommercialRecommendation {
  return {
    advice:
      'Quality businesses matter more than quantity. I\'ll prioritize companies with complete profiles.',
    priorityField: 'commercial_intelligence_version',
    priorityValue: 'v2',
    confidence: 0.5,
  }
}

export async function generateCommercialRecommendation(
  offering: string,
  audience: string,
  goal: string,
  useLLM: boolean = false
): Promise<CommercialRecommendation> {
  // Try deterministic rule first
  const rule = matchIndustryRule(offering, audience)
  if (rule) {
    return {
      advice: rule.advice,
      priorityField: rule.priorityField,
      priorityValue: rule.priorityValue,
      confidence: 0.85,
    }
  }

  // If LLM is enabled and rules didn't match, try LLM
  if (useLLM) {
    try {
      const recommendation = await callLLMForRecommendation(
        offering,
        audience,
        goal
      )
      if (recommendation) {
        return recommendation
      }
    } catch (err) {
      console.error(
        '[commercial-recommendation] LLM call failed, falling back:',
        err
      )
    }
  }

  // Fallback to generic
  return getGenericRecommendation()
}

async function callLLMForRecommendation(
  offering: string,
  audience: string,
  goal: string
): Promise<CommercialRecommendation | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(
      '/api/outreach/commercial-recommendation',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offering,
          audience,
          goal,
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data as CommercialRecommendation
  } catch (err) {
    // Timeout or network error
    console.error('[commercial-recommendation] LLM failed:', err)
    return null
  }
}
