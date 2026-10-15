import type { CostContext } from '@/lib/costs/context'
import { openAiCostOf } from '@/lib/costs/pricing'
import { recordApiUsage } from '@/lib/costs/record'

type Usage = { prompt_tokens?: number | null; completion_tokens?: number | null } | null | undefined

/** Records one OpenAI chat completion: the tokens are the provider's own count, the dollar figure is an estimate at list price. */
export function recordOpenAiCompletion(model: string, usage: Usage, purpose?: CostContext['purpose'], ok = true) {
  const inputTokens = usage?.prompt_tokens ?? 0
  const outputTokens = usage?.completion_tokens ?? 0
  recordApiUsage({
    provider: 'openai',
    operation: 'chat_completion',
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: openAiCostOf(model, inputTokens, outputTokens),
    ok,
    context: purpose ? { purpose } : undefined,
  })
}
