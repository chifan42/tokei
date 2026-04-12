import { sql } from 'drizzle-orm'
import { aggregateToday, aggregateMonth, sparkline7d, sparkline7dPerTool, weeklyTrend } from '../db/aggregate'
import { getDailyQuote } from '../db/quotes'
import type { Db } from '../db/events'
import type { SummaryResponse } from '../contract'

export type SummaryDeps = { db: Db; now: number; tz: string }

export async function summaryHandler(deps: SummaryDeps): Promise<SummaryResponse> {
  const { db, now, tz } = deps

  const [today, month, sparkline, toolSparklines, trend, fallbackTokens] = await Promise.all([
    aggregateToday(db, now, tz),
    aggregateMonth(db, now, tz),
    sparkline7d(db, now, tz),
    sparkline7dPerTool(db, now, tz),
    weeklyTrend(db, now, tz),
    sumFallbackPricedTokensToday(db, now, tz),
  ])

  const dateYmd = formatYmd(now, tz)
  const quote = await getDailyQuote(db, dateYmd)

  return {
    today: {
      total_tokens: today.total_tokens,
      total_usd: round2(today.total_usd),
      tools: (() => {
        // Include all tools that appear in either today or month, so firmware
        // always shows all active tools (even if 0 today).
        const todayMap = new Map(today.tools.map((t) => [t.name, t]))
        const allNames = new Set([...today.tools.map((t) => t.name), ...month.tools.map((t) => t.name as typeof today.tools[number]['name'])])
        return [...allNames].map((name) => {
          const t = todayMap.get(name)
          const ts = toolSparklines.find((s) => s.name === name)
          return {
            name: name as typeof today.tools[number]['name'],
            tokens: t?.tokens ?? 0,
            usd: round2(t?.usd ?? 0),
            sparkline_7d: ts?.sparkline ?? [0, 0, 0, 0, 0, 0, 0],
          }
        }).sort((a, b) => b.tokens - a.tokens)
      })(),
    },
    month: {
      total_tokens: month.total_tokens,
      total_usd: round2(month.total_usd),
      tools: month.tools.map((t) => ({ name: t.name, tokens: t.tokens, usd: round2(t.usd) })),
    },
    sparkline_7d: sparkline,
    weekly_trend: trend,
    quote: { text: quote.text, attr: quote.attr ?? '', category: quote.category, lang: quote.lang },
    sync_ts: now,
    fallback_priced_tokens: fallbackTokens,
  }
}

async function sumFallbackPricedTokensToday(db: Db, now: number, tz: string): Promise<number> {
  if (tz !== 'Asia/Shanghai') throw new Error(`Unsupported tz: ${tz}`)
  const offsetSec = 8 * 3600
  const local = now + offsetSec
  const todayStart = local - (local % 86400) - offsetSec
  const row = await db.get<{ n: number }>(
    sql`
      SELECT CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS n
      FROM events
      WHERE ts >= ${todayStart} AND used_fallback_price = 1
    `,
  )
  return row?.n ?? 0
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function formatYmd(now: number, tz: string): string {
  if (tz !== 'Asia/Shanghai') throw new Error(`Unsupported tz: ${tz}`)
  const localMs = (now + 8 * 3600) * 1000
  const d = new Date(localMs)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
