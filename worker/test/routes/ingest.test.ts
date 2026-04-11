import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices, events } from '../../src/db/schema'
import { ingestHandler } from '../../src/routes/ingest'
import { FALLBACK_MODEL } from '../../src/db/prices'

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

const NOW = 1744430400

describe('ingestHandler', () => {
  it('inserts events and returns { accepted, deduped }', async () => {
    const result = await ingestHandler(
      {
        device_id: 'dev-1',
        events: [
          {
            tool: 'claude_code',
            event_uuid: 'u1',
            ts: NOW,
            model: 'claude-sonnet-4-5',
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 0,
          },
        ],
      },
      { db: db(), now: NOW },
    )
    expect(result.accepted).toBe(1)
    expect(result.deduped).toBe(0)

    const rows = await db().select().from(events).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.usdCost).toBeCloseTo(100 * 3e-6 + 50 * 15e-6, 6)
  })

  it('rejects events with ts skewed > 1 day from now', async () => {
    const futureTs = NOW + 86400 * 2
    await expect(
      ingestHandler(
        {
          device_id: 'dev-1',
          events: [
            {
              tool: 'claude_code',
              event_uuid: 'u1',
              ts: futureTs,
              model: 'claude-sonnet-4-5',
              input_tokens: 100,
              output_tokens: 0,
              cached_input_tokens: 0,
              cache_creation_tokens: 0,
              reasoning_output_tokens: 0,
            },
          ],
        },
        { db: db(), now: NOW },
      ),
    ).rejects.toThrow(/CLOCK_SKEW/)
  })
})
