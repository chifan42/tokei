import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { insertEvents } from '../../src/db/events'
import { aggregateToday } from '../../src/db/aggregate'
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
