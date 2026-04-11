import { sql } from 'drizzle-orm'
import { prices } from '../db/schema'
import type { Db } from '../db/events'

type LiteLlmEntry = {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_read_input_token_cost?: number
  cache_creation_input_token_cost?: number
}

export async function fetchAndStorePrices(
  db: Db,
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const res = await fetcher(url)
  if (!res.ok) {
    throw new Error(`LiteLLM price fetch failed: HTTP ${res.status}`)
  }
  const data = (await res.json()) as Record<string, LiteLlmEntry>

  const now = Math.floor(Date.now() / 1000)
  const rows = Object.entries(data)
    .filter(([_key, entry]) =>
      typeof entry === 'object' &&
      entry != null &&
      typeof entry.input_cost_per_token === 'number' &&
      typeof entry.output_cost_per_token === 'number',
    )
    .map(([model, entry]) => ({
      model,
      inputCostPerToken: entry.input_cost_per_token as number,
      outputCostPerToken: entry.output_cost_per_token as number,
      cacheReadInputTokenCost: entry.cache_read_input_token_cost ?? null,
      cacheCreationInputTokenCost: entry.cache_creation_input_token_cost ?? null,
      updatedAt: now,
    }))

  // Chunk upserts to respect D1 parameter limits.
  const CHUNK = 50
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    // Use raw SQL upsert because Drizzle's onConflictDoUpdate column refs
    // may not resolve to `excluded.*` correctly in all versions.
    for (const row of slice) {
      await db.run(
        sql`INSERT INTO prices (model, input_cost_per_token, output_cost_per_token, cache_read_input_token_cost, cache_creation_input_token_cost, updated_at)
            VALUES (${row.model}, ${row.inputCostPerToken}, ${row.outputCostPerToken}, ${row.cacheReadInputTokenCost}, ${row.cacheCreationInputTokenCost}, ${row.updatedAt})
            ON CONFLICT(model) DO UPDATE SET
              input_cost_per_token = excluded.input_cost_per_token,
              output_cost_per_token = excluded.output_cost_per_token,
              cache_read_input_token_cost = excluded.cache_read_input_token_cost,
              cache_creation_input_token_cost = excluded.cache_creation_input_token_cost,
              updated_at = excluded.updated_at`,
      )
    }
  }

  return rows.length
}
