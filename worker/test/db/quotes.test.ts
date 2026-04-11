import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { getDailyQuote } from '../../src/db/quotes'

const db = () => drizzle(env.DB)

describe('getDailyQuote', () => {
  it('returns the same quote for the same date', async () => {
    const a = await getDailyQuote(db(), '2026-04-12')
    const b = await getDailyQuote(db(), '2026-04-12')
    expect(a.text).toBe(b.text)
    expect(a.id).toBe(b.id)
  })

  it('has required fields', async () => {
    const q = await getDailyQuote(db(), '2026-04-12')
    expect(q.text).toBeTruthy()
    expect(['computing', 'poetry-tang', 'scifi', 'philosophy']).toContain(q.category)
    expect(['en', 'zh']).toContain(q.lang)
  })

  it('cycles through multiple quotes across 20 dates (has variance)', async () => {
    const seen = new Set<number>()
    for (let d = 1; d <= 20; d++) {
      const q = await getDailyQuote(db(), `2026-04-${String(d).padStart(2, '0')}`)
      seen.add(q.id)
    }
    // With 8 seed quotes and 20 dates, we expect at least 3 distinct quotes
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })
})
