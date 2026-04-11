import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import { events } from './schema'
import { getPriceWithFallback, computeUsdCost } from './prices'
import type { EventInput } from '../contract'

export type InsertResult = { accepted: number; deduped: number }
export type Db = ReturnType<typeof drizzle>

// D1 caps bound parameters per statement at 100. The events table has 12
// fields per row, so 7 rows per INSERT keeps us at 84 params (safe margin).
// The countExisting query uses raw SQL literals so it can take a larger chunk.
const INSERT_CHUNK = 7
const COUNT_CHUNK = 100

export async function insertEvents(db: Db, deviceId: string, batch: EventInput[]): Promise<InsertResult> {
  if (batch.length === 0) return { accepted: 0, deduped: 0 }

  // Price each row at insert time. Prices are cached by model to avoid repeat lookups.
  const priceCache = new Map<string, Awaited<ReturnType<typeof getPriceWithFallback>>>()
  const rows = await Promise.all(
    batch.map(async (e) => {
      const key = e.model ?? '__null__'
      let price = priceCache.get(key)
      if (!price) {
        price = await getPriceWithFallback(db, e.model)
        priceCache.set(key, price)
      }
      return {
        deviceId,
        tool: e.tool,
        eventUuid: e.event_uuid,
        ts: e.ts,
        model: e.model,
        inputTokens: e.input_tokens,
        cachedInputTokens: e.cached_input_tokens,
        outputTokens: e.output_tokens,
        cacheCreationTokens: e.cache_creation_tokens,
        reasoningOutputTokens: e.reasoning_output_tokens,
        usdCost: computeUsdCost(price, e),
        usedFallbackPrice: price.usedFallback,
      }
    }),
  )

  let totalExisting = 0
  for (let i = 0; i < batch.length; i += COUNT_CHUNK) {
    totalExisting += await countExistingChunk(db, deviceId, batch.slice(i, i + COUNT_CHUNK))
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(events).values(rows.slice(i, i + INSERT_CHUNK)).onConflictDoNothing().run()
  }

  const accepted = batch.length - totalExisting
  return { accepted, deduped: totalExisting }
}

async function countExistingChunk(db: Db, deviceId: string, chunk: EventInput[]): Promise<number> {
  if (chunk.length === 0) return 0
  const tuples = chunk.map((e) => `('${escapeSql(e.tool)}', '${escapeSql(e.event_uuid)}')`).join(',')
  const query = sql.raw(
    `SELECT COUNT(*) as n FROM events WHERE device_id = '${escapeSql(deviceId)}' AND (tool, event_uuid) IN (${tuples})`,
  )
  const result = await db.all<{ n: number }>(query)
  return result[0]?.n ?? 0
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}
