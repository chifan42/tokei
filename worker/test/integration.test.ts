import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../src/db/schema'
import { ingestHandler } from '../src/routes/ingest'
import { summaryHandler } from '../src/routes/summary'
import { FALLBACK_MODEL } from '../src/db/prices'

const db = () => drizzle(env.DB)
const NOW = 1744430400
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
        updatedAt: NOW,
      },
      {
        model: FALLBACK_MODEL,
        inputCostPerToken: 5e-6,
        outputCostPerToken: 25e-6,
        cacheReadInputTokenCost: null,
        cacheCreationInputTokenCost: null,
        updatedAt: NOW,
      },
    ])
    .run()
})

describe('integration: ingest then summary', () => {
  it('produces a valid summary after ingesting events from 3 devices', async () => {
    await ingestHandler(
      {
        device_id: 'dev-1',
        events: [
          {
            tool: 'claude_code',
            event_uuid: 'e1',
            ts: NOW,
            model: 'claude-sonnet-4-5',
            input_tokens: 5000,
            output_tokens: 1000,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 0,
          },
        ],
      },
      { db: db(), now: NOW },
    )

    await ingestHandler(
      {
        device_id: 'dev-2',
        events: [
          {
            tool: 'cursor',
            event_uuid: 'e2',
            ts: NOW,
            model: null,
            input_tokens: 3000,
            output_tokens: 500,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 0,
          },
        ],
      },
      { db: db(), now: NOW },
    )

    await ingestHandler(
      {
        device_id: 'dev-3',
        events: [
          {
            tool: 'codex',
            event_uuid: 'e3',
            ts: NOW,
            model: 'claude-sonnet-4-5',
            input_tokens: 2000,
            output_tokens: 400,
            cached_input_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_output_tokens: 50,
          },
        ],
      },
      { db: db(), now: NOW },
    )

    const summary = await summaryHandler({ db: db(), now: NOW, tz: TZ })

    expect(summary.today.total_tokens).toBe(5000 + 1000 + 3000 + 500 + 2000 + 400 + 50)
    expect(summary.today.tools).toHaveLength(3)
    expect(summary.fallback_priced_tokens).toBe(3000 + 500) // cursor event had null model
    expect(summary.quote.text).toBeTruthy()
    expect(summary.sparkline_7d).toHaveLength(7)
  })

  it('dedups repeated ingest of same events', async () => {
    const batch = {
      device_id: 'dev-1',
      events: [
        {
          tool: 'claude_code' as const,
          event_uuid: 'dup',
          ts: NOW,
          model: 'claude-sonnet-4-5',
          input_tokens: 1000,
          output_tokens: 500,
          cached_input_tokens: 0,
          cache_creation_tokens: 0,
          reasoning_output_tokens: 0,
        },
      ],
    }
    const r1 = await ingestHandler(batch, { db: db(), now: NOW })
    const r2 = await ingestHandler(batch, { db: db(), now: NOW })
    expect(r1).toEqual({ accepted: 1, deduped: 0 })
    expect(r2).toEqual({ accepted: 0, deduped: 1 })

    const summary = await summaryHandler({ db: db(), now: NOW, tz: TZ })
    expect(summary.today.total_tokens).toBe(1500) // not doubled
  })
})
