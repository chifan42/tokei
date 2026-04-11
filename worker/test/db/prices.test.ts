import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { prices } from '../../src/db/schema'
import { getPriceWithFallback, computeUsdCost, FALLBACK_MODEL } from '../../src/db/prices'

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
        cacheReadInputTokenCost: 0.5e-6,
        cacheCreationInputTokenCost: 6.25e-6,
        updatedAt: 1744000000,
      },
    ])
    .run()
})

describe('getPriceWithFallback', () => {
  it('returns exact-match price when model exists', async () => {
    const price = await getPriceWithFallback(db(), 'claude-sonnet-4-5')
    expect(price.model).toBe('claude-sonnet-4-5')
    expect(price.usedFallback).toBe(false)
    expect(price.inputCostPerToken).toBe(3e-6)
  })

  it('returns Opus fallback when model is unknown', async () => {
    const price = await getPriceWithFallback(db(), 'gpt-999-future')
    expect(price.model).toBe(FALLBACK_MODEL)
    expect(price.usedFallback).toBe(true)
    expect(price.inputCostPerToken).toBe(5e-6)
  })

  it('returns Opus fallback when model is null', async () => {
    const price = await getPriceWithFallback(db(), null)
    expect(price.usedFallback).toBe(true)
  })
})

describe('computeUsdCost', () => {
  it('sums input + output cost', () => {
    const price = {
      model: 'claude-sonnet-4-5',
      inputCostPerToken: 3e-6,
      outputCostPerToken: 15e-6,
      cacheReadInputTokenCost: 0.3e-6,
      cacheCreationInputTokenCost: 3.75e-6,
      usedFallback: false,
    }
    const event = {
      input_tokens: 1000,
      output_tokens: 500,
      cached_input_tokens: 0,
      cache_creation_tokens: 0,
      reasoning_output_tokens: 0,
    }
    // 1000 * 3e-6 + 500 * 15e-6 = 0.003 + 0.0075 = 0.0105
    expect(computeUsdCost(price, event)).toBeCloseTo(0.0105, 6)
  })

  it('includes cache read + cache creation when price available', () => {
    const price = {
      model: 'claude-sonnet-4-5',
      inputCostPerToken: 3e-6,
      outputCostPerToken: 15e-6,
      cacheReadInputTokenCost: 0.3e-6,
      cacheCreationInputTokenCost: 3.75e-6,
      usedFallback: false,
    }
    const event = {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 1000,
      cache_creation_tokens: 1000,
      reasoning_output_tokens: 0,
    }
    // 1000 * 0.3e-6 + 1000 * 3.75e-6 = 0.0003 + 0.00375 = 0.00405
    expect(computeUsdCost(price, event)).toBeCloseTo(0.00405, 6)
  })

  it('counts reasoning output at output rate', () => {
    const price = {
      model: 'claude-sonnet-4-5',
      inputCostPerToken: 3e-6,
      outputCostPerToken: 15e-6,
      cacheReadInputTokenCost: 0.3e-6,
      cacheCreationInputTokenCost: 3.75e-6,
      usedFallback: false,
    }
    const event = {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_tokens: 0,
      reasoning_output_tokens: 1000,
    }
    // 1000 * 15e-6 = 0.015
    expect(computeUsdCost(price, event)).toBeCloseTo(0.015, 6)
  })
})
