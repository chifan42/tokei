import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import { events } from './schema'
import { getPriceWithFallback, computeUsdCost } from './prices'
import type { EventInput } from '../contract'

export type InsertResult = { accepted: number; deduped: number }
export type Db = ReturnType<typeof drizzle>

export async function insertEvents(db: Db, deviceId: string, batch: EventInput[]): Promise<InsertResult> {
  if (batch.length === 0) return { accepted: 0, deduped: 0 }

  const before = await countExisting(db, deviceId, batch)

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

  await db.insert(events).values(rows).onConflictDoNothing().run()

  const accepted = batch.length - before
  return { accepted, deduped: before }
}

async function countExisting(db: Db, deviceId: string, batch: EventInput[]): Promise<number> {
  const tuples = batch.map((e) => `('${escapeSql(e.tool)}', '${escapeSql(e.event_uuid)}')`).join(',')
  const query = sql.raw(
    `SELECT COUNT(*) as n FROM events WHERE device_id = '${escapeSql(deviceId)}' AND (tool, event_uuid) IN (${tuples})`,
  )
  const result = await db.all<{ n: number }>(query)
  return result[0]?.n ?? 0
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}
