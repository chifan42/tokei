import { describe, it, expect, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { fetchAndStorePrices } from '../../src/cron/fetchPrices'
import { eq } from 'drizzle-orm'

const db = () => drizzle(env.DB)

const MOCK_JSON = {
  'claude-sonnet-4-5': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  'claude-opus-4-6': {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 25e-6,
    cache_read_input_token_cost: 0.5e-6,
    cache_creation_input_token_cost: 6.25e-6,
  },
  'gpt-4o': {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 10e-6,
  },
  'sample_spec': {
    // Non-model entry to be skipped
    mode: 'chat',
  },
}

describe('fetchAndStorePrices', () => {
  it('parses LiteLLM JSON and upserts rows', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(MOCK_JSON), { status: 200 }))

    const stored = await fetchAndStorePrices(db(), 'https://fake.local/prices.json', fetcher)
    expect(stored).toBe(3) // 3 model entries with input_cost_per_token

    const sonnet = await db().select().from(prices).where(eq(prices.model, 'claude-sonnet-4-5')).get()
    expect(sonnet?.inputCostPerToken).toBe(3e-6)
    expect(sonnet?.outputCostPerToken).toBe(15e-6)

    const opus = await db().select().from(prices).where(eq(prices.model, 'claude-opus-4-6')).get()
    expect(opus?.inputCostPerToken).toBe(5e-6)
  })

  it('replaces existing rows (upsert behavior)', async () => {
    await db()
      .insert(prices)
      .values({
        model: 'claude-sonnet-4-5',
        inputCostPerToken: 999, // stale value
        outputCostPerToken: 999,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: 1000,
      })
      .run()

    const fetcher = vi.fn(async () => new Response(JSON.stringify(MOCK_JSON), { status: 200 }))
    await fetchAndStorePrices(db(), 'https://fake.local/prices.json', fetcher)

    const row = await db().select().from(prices).where(eq(prices.model, 'claude-sonnet-4-5')).get()
    expect(row?.inputCostPerToken).toBe(3e-6)
  })

  it('throws on non-200 response', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 500 }))
    await expect(fetchAndStorePrices(db(), 'https://fake.local/prices.json', fetcher)).rejects.toThrow(/500/)
  })
})
