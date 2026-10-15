import type { CostContext } from '@/lib/costs/context'
import { openAiCostOf } from '@/lib/costs/pricing'
import { recordApiUsage } from '@/lib/costs/record'

type Usage = { prompt_tokens?: number | null; completion_tokens?: number | null } | null | undefined

/**
 * Records one OpenAI chat completion: tokens are the provider's own count, the dollar figure is an estimate. The completion's own id
 * identifies the event, so recording the same response twice counts it once; a genuinely repeated call is a new response and counts.
 * Await it: the write is bounded (see record.ts) and never throws, and awaiting keeps a serverless function alive long enough to land it.
 */
export function recordOpenAiCompletion(
  model: string,
  completion: { id?: string | null; usage?: Usage } | null | undefined,
  purpose?: CostContext['purpose'],
  ok = true
): Promise<void> {
  const usage = completion?.usage
  const inputTokens = usage?.prompt_tokens ?? 0
  const outputTokens = usage?.completion_tokens ?? 0
  return recordApiUsage({
    provider: 'openai',
    operation: 'chat_completion',
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: openAiCostOf(model, inputTokens, outputTokens),
    ok,
    eventKey: completion?.id ? `openai:${completion.id}` : undefined,
    context: purpose ? { purpose } : undefined,
  })
}
