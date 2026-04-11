import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { insertEvents } from '../../src/db/events'
import { summaryHandler } from '../../src/routes/summary'
import { FALLBACK_MODEL } from '../../src/db/prices'
import type { EventInput } from '../../src/contract'

const db = () => drizzle(env.DB)
const TODAY_NOON = 1744430400
const TZ = 'Asia/Shanghai'

beforeEach(async () => {
  await db()
    .insert(prices)
    .values([
      {
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 3e-6,
        outputCostPerToken: 15e-6,
        cacheReadInputTokenCost: 0.3e-6,
        cacheCreationInputTokenCost: 3.75e-6,
        updatedAt: 1744000000,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

const sample = (o: Partial<EventInput> = {}): EventInput => ({
  tool: 'claude_code',
  event_uuid: `u-${Math.random()}`,
  ts: TODAY_NOON,
  model: 'claude-sonnet-4-5',
  input_tokens: 1000,
  output_tokens: 500,
  cached_input_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_output_tokens: 0,
  ...o,
})

describe('summaryHandler', () => {
  it('returns a complete summary payload with today, month, sparkline, quote, sync_ts', async () => {
    await insertEvents(db(), 'dev-1', [sample({ tool: 'claude_code' }), sample({ tool: 'cursor' })])
    const result = await summaryHandler({ db: db(), now: TODAY_NOON, tz: TZ })

    expect(result.today.tools).toHaveLength(2)
    expect(result.today.total_tokens).toBe((1000 + 500) * 2)
    expect(result.month.total_tokens).toBeGreaterThanOrEqual(result.today.total_tokens)
    expect(result.sparkline_7d).toHaveLength(7)
    expect(result.quote.text).toBeTruthy()
    expect(result.sync_ts).toBe(TODAY_NOON)
    expect(result.fallback_priced_tokens).toBe(0)
  })

  it('counts fallback_priced_tokens from events with used_fallback_price', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ model: 'gpt-unknown', input_tokens: 1500, output_tokens: 0 }),
    ])
    const result = await summaryHandler({ db: db(), now: TODAY_NOON, tz: TZ })
    expect(result.fallback_priced_tokens).toBe(1500)
  })
})
