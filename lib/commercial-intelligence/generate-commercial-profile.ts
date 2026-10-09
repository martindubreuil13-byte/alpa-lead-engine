import { openai } from '@/lib/ai/openai'

import {
  OPENAI_PROFILE_REQUEST_OPTIONS,
  generateProfileFromEvidence,
  type ProfileCompletion,
} from './commercial-profile-core'
import type { BusinessSignals, CommercialProfile, ExtractionResult, WebsiteSnapshot } from './types'

const MODEL = 'gpt-4o-mini'
const MAX_TOKENS = 500

type GenerateProfileOptions = {
  complete?: ProfileCompletion
}

export async function generateCommercialProfile(
  website: string | null | undefined,
  snapshot: WebsiteSnapshot | null | undefined,
  signals: BusinessSignals | null | undefined,
  options: GenerateProfileOptions = {}
): Promise<ExtractionResult<CommercialProfile>> {
  const startTime = Date.now()

  if (!website) {
    return failure('NO_WEBSITE', 'Website URL is required', startTime, 0)
  }

  if (!snapshot || !signals) {
    return failure(
      'MISSING_DATA',
      'Website Snapshot and Business Signals required',
      startTime,
      0
    )
  }

  if (!options.complete && !process.env.OPENAI_API_KEY) {
    return failure('MISSING_API_KEY', 'OpenAI API key not configured', startTime, 0)
  }

  const complete: ProfileCompletion =
    options.complete ||
    (async (prompt) => {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You produce factual business profiles using only supplied website evidence. Never speculate or fill gaps. Return valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
        response_format: { type: 'json_object' },
      }, OPENAI_PROFILE_REQUEST_OPTIONS)

      return {
        content: completion.choices[0]?.message?.content || '',
        inputTokens: completion.usage?.prompt_tokens || 0,
        outputTokens: completion.usage?.completion_tokens || 0,
      }
    })

  try {
    const result = await generateProfileFromEvidence(website, snapshot, signals, complete)
    const cost = estimateTokenCost(result.inputTokens, result.outputTokens)

    if (!result.ok) {
      return failure(result.error.code, result.error.message, startTime, cost)
    }

    return {
      ok: true,
      data: result.data,
      duration_ms: Date.now() - startTime,
      cost,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown OpenAI error'
    return failure('API_ERROR', message, startTime, 0)
  }
}

function failure(
  code: string,
  message: string,
  startTime: number,
  cost: number
): ExtractionResult<CommercialProfile> {
  return {
    ok: false,
    error: { code, message },
    duration_ms: Date.now() - startTime,
    cost,
  }
}

function estimateTokenCost(inputTokens: number, outputTokens: number) {
  return inputTokens * 0.00000015 + outputTokens * 0.0000006
}
