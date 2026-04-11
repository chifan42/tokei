import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { insertEvents } from '../../src/db/events'
import { aggregateToday, aggregateMonth, sparkline7d } from '../../src/db/aggregate'
import { FALLBACK_MODEL } from '../../src/db/prices'
import type { EventInput } from '../../src/contract'

const TZ = 'Asia/Shanghai'
const db = () => drizzle(env.DB)

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

// 2026-04-12 12:00 UTC+8 = 1744430400
const TODAY_NOON = 1744430400
const YESTERDAY_NOON = TODAY_NOON - 86400

const sample = (overrides: Partial<EventInput> = {}): EventInput => ({
  tool: 'claude_code',
  event_uuid: `uuid-${Math.random()}`,
  ts: TODAY_NOON,
  model: 'claude-sonnet-4-5',
  input_tokens: 1000,
  output_tokens: 500,
  cached_input_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_output_tokens: 0,
  ...overrides,
})

describe('aggregateToday', () => {
  it('sums today tokens grouped by tool', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'claude_code', input_tokens: 1000, output_tokens: 500 }),
      sample({ tool: 'claude_code', input_tokens: 2000, output_tokens: 1000 }),
      sample({ tool: 'cursor', input_tokens: 500, output_tokens: 200 }),
    ])

    const result = await aggregateToday(db(), TODAY_NOON, TZ)

    expect(result.total_tokens).toBe(1000 + 500 + 2000 + 1000 + 500 + 200)
    expect(result.tools).toHaveLength(2)
    const cc = result.tools.find((t) => t.name === 'claude_code')
    expect(cc?.tokens).toBe(1000 + 500 + 2000 + 1000)
    const cur = result.tools.find((t) => t.name === 'cursor')
    expect(cur?.tokens).toBe(500 + 200)
  })

  it('excludes events outside today window', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'claude_code', event_uuid: 'today-1', ts: TODAY_NOON }),
      sample({ tool: 'claude_code', event_uuid: 'yesterday-1', ts: YESTERDAY_NOON }),
    ])

    const result = await aggregateToday(db(), TODAY_NOON, TZ)
    expect(result.total_tokens).toBe(1000 + 500)
    expect(result.tools).toHaveLength(1)
  })

  it('sums usd_cost across tools', async () => {
    await insertEvents(db(), 'dev-1', [sample({ input_tokens: 1000, output_tokens: 500 })])
    const result = await aggregateToday(db(), TODAY_NOON, TZ)
    expect(result.total_usd).toBeCloseTo(1000 * 3e-6 + 500 * 15e-6, 6)
  })

  it('sorts tools by tokens descending', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'cursor', input_tokens: 5000, output_tokens: 0 }),
      sample({ tool: 'claude_code', input_tokens: 100, output_tokens: 0 }),
    ])
    const result = await aggregateToday(db(), TODAY_NOON, TZ)
    expect(result.tools[0]?.name).toBe('cursor')
    expect(result.tools[1]?.name).toBe('claude_code')
  })
})

// first of April 2026 UTC+8 = 2026-04-01 00:00 CST = 1743436800
const APR_1 = 1743436800
const APR_12 = APR_1 + 11 * 86400
const MAR_31 = APR_1 - 3600

describe('aggregateMonth', () => {
  it('sums tokens from month start to now', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ tool: 'claude_code', event_uuid: 'apr-1', ts: APR_1, input_tokens: 1000, output_tokens: 0 }),
      sample({ tool: 'claude_code', event_uuid: 'apr-12', ts: APR_12, input_tokens: 2000, output_tokens: 0 }),
      sample({ tool: 'claude_code', event_uuid: 'mar-31', ts: MAR_31, input_tokens: 99999, output_tokens: 0 }),
    ])
    const result = await aggregateMonth(db(), APR_12, TZ)
    expect(result.total_tokens).toBe(1000 + 2000)
  })
})

describe('sparkline7d', () => {
  it('returns 7 integer values (k tokens) oldest to newest', async () => {
    // Insert 1 event per day for 7 days, with increasing token counts
    for (let i = 0; i < 7; i++) {
      await insertEvents(db(), 'dev-1', [
        sample({
          event_uuid: `day-${i}`,
          ts: TODAY_NOON - i * 86400,
          input_tokens: (7 - i) * 1000, // newer day = more tokens
          output_tokens: 0,
        }),
      ])
    }

    const result = await sparkline7d(db(), TODAY_NOON, TZ)
    expect(result).toHaveLength(7)
    // Oldest first: day-6 (1k), day-5 (2k), ..., day-0 (7k)
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('fills missing days with 0', async () => {
    await insertEvents(db(), 'dev-1', [
      sample({ event_uuid: 'today', ts: TODAY_NOON, input_tokens: 5000, output_tokens: 0 }),
      sample({ event_uuid: 'four-days-ago', ts: TODAY_NOON - 4 * 86400, input_tokens: 3000, output_tokens: 0 }),
    ])

    const result = await sparkline7d(db(), TODAY_NOON, TZ)
    // Indices: 0=6 days ago, 6=today
    expect(result[6]).toBe(5)
    expect(result[2]).toBe(3)
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(0)
  })
})
