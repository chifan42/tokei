import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { events, prices } from '../../src/db/schema'
import { insertEvents } from '../../src/db/events'
import { FALLBACK_MODEL } from '../../src/db/prices'
import type { EventInput } from '../../src/contract'

const db = () => drizzle(env.DB)

const sample = (overrides: Partial<EventInput> = {}): EventInput => ({
  tool: 'claude_code',
  event_uuid: 'uuid-1',
  ts: 1744370000,
  model: 'claude-sonnet-4-5',
  input_tokens: 100,
  output_tokens: 50,
  cached_input_tokens: 0,
  cache_creation_tokens: 0,
  reasoning_output_tokens: 0,
  ...overrides,
})

describe('insertEvents', () => {
  it('inserts new events and returns accepted count', async () => {
    const result = await insertEvents(db(), 'dev-1', [sample(), sample({ event_uuid: 'uuid-2' })])
    expect(result.accepted).toBe(2)
    expect(result.deduped).toBe(0)

    const rows = await db().select().from(events).all()
    expect(rows).toHaveLength(2)
  })

  it('dedups on (device_id, tool, event_uuid)', async () => {
    await insertEvents(db(), 'dev-1', [sample()])
    const result = await insertEvents(db(), 'dev-1', [sample(), sample({ event_uuid: 'uuid-2' })])
    expect(result.accepted).toBe(1)
    expect(result.deduped).toBe(1)
  })

  it('allows same event_uuid from different devices', async () => {
    await insertEvents(db(), 'dev-1', [sample()])
    const result = await insertEvents(db(), 'dev-2', [sample()])
    expect(result.accepted).toBe(1)
    expect(result.deduped).toBe(0)
  })
})

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
        cacheReadInputTokenCost: 0.5e-6,
        cacheCreationInputTokenCost: 6.25e-6,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

describe('insertEvents · usd_cost snapshot', () => {
  it('computes usd_cost using current price at insert time', async () => {
    await insertEvents(db(), 'dev-1', [sample({ input_tokens: 1000, output_tokens: 500 })])
    const row = await db().select().from(events).get()
    expect(row?.usdCost).toBeCloseTo(1000 * 3e-6 + 500 * 15e-6, 6)
    expect(row?.usedFallbackPrice).toBe(false)
  })

  it('marks usedFallbackPrice=true for unknown model', async () => {
    await insertEvents(db(), 'dev-1', [sample({ model: 'gpt-unknown', input_tokens: 1000, output_tokens: 0 })])
    const row = await db().select().from(events).get()
    expect(row?.usedFallbackPrice).toBe(true)
    // fallback Opus: 1000 * 5e-6 = 0.005
    expect(row?.usdCost).toBeCloseTo(0.005, 6)
  })
})
