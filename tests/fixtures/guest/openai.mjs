// A stand-in for the paid model: counts calls, records exactly what would be sent, and never reaches the network.
export const ai = {calls: [], content: null, delayMs: 0, fail: false}
export const openai = {chat: {completions: {create: async (params, options) => {
  ai.calls.push({params, options})
  if (ai.delayMs) await new Promise((resolve) => setTimeout(resolve, ai.delayMs))
  if (ai.fail) throw new Error('model unavailable')
  return {choices: [{message: {content: ai.content}}], usage: {prompt_tokens: 420, completion_tokens: 70}}
}}}}
