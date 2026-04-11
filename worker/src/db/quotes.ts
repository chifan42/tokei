import { eq, asc } from 'drizzle-orm'
import { quotes } from './schema'
import type { Db } from './events'

export type QuoteRow = {
  id: number
  text: string
  attr: string | null
  category: 'computing' | 'poetry-tang' | 'scifi' | 'philosophy'
  lang: 'en' | 'zh'
}

/** Deterministic daily rotation: hash(YYYY-MM-DD) mod N. */
export async function getDailyQuote(db: Db, dateYmd: string): Promise<QuoteRow> {
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.enabled, true))
    .orderBy(asc(quotes.id))
    .all()

  if (rows.length === 0) {
    throw new Error('No enabled quotes found. Seed the quotes table before calling /summary.')
  }

  const idx = fnv1a(dateYmd) % rows.length
  const chosen = rows[idx]!
  return {
    id: chosen.id,
    text: chosen.text,
    attr: chosen.attr,
    category: chosen.category,
    lang: chosen.lang,
  }
}

// Small non-cryptographic hash. 32-bit FNV-1a.
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
