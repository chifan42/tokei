import { eq } from 'drizzle-orm'
import { prices } from './schema'
import type { Db } from './events'

export const FALLBACK_MODEL = 'claude-opus-4-6'

export type PriceRow = {
  model: string
  inputCostPerToken: number
  outputCostPerToken: number
  cacheReadInputTokenCost: number | null
  cacheCreationInputTokenCost: number | null
  usedFallback: boolean
}

export async function getPriceWithFallback(db: Db, model: string | null): Promise<PriceRow> {
  if (model) {
    const row = await db.select().from(prices).where(eq(prices.model, model)).get()
    if (row) {
      return {
        model: row.model,
        inputCostPerToken: row.inputCostPerToken,
        outputCostPerToken: row.outputCostPerToken,
        cacheReadInputTokenCost: row.cacheReadInputTokenCost,
        cacheCreationInputTokenCost: row.cacheCreationInputTokenCost,
        usedFallback: false,
      }
    }
  }
  const fallback = await db.select().from(prices).where(eq(prices.model, FALLBACK_MODEL)).get()
  if (!fallback) {
    throw new Error(`Fallback price row missing: ${FALLBACK_MODEL}. Run price sync cron first.`)
  }
  return {
    model: fallback.model,
    inputCostPerToken: fallback.inputCostPerToken,
    outputCostPerToken: fallback.outputCostPerToken,
    cacheReadInputTokenCost: fallback.cacheReadInputTokenCost,
    cacheCreationInputTokenCost: fallback.cacheCreationInputTokenCost,
    usedFallback: true,
  }
}

export type CostableEvent = {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_creation_tokens: number
  reasoning_output_tokens: number
}

export function computeUsdCost(price: PriceRow, event: CostableEvent): number {
  const cacheRead = price.cacheReadInputTokenCost ?? price.inputCostPerToken
  const cacheCreate = price.cacheCreationInputTokenCost ?? price.inputCostPerToken
  return (
    event.input_tokens * price.inputCostPerToken +
    event.output_tokens * price.outputCostPerToken +
    event.cached_input_tokens * cacheRead +
    event.cache_creation_tokens * cacheCreate +
    event.reasoning_output_tokens * price.outputCostPerToken
  )
}
