import { sql } from 'drizzle-orm'
import type { Db } from './events'

export type TodayResult = {
  total_tokens: number
  total_usd: number
  tools: { name: 'claude_code' | 'codex' | 'cursor' | 'gemini'; tokens: number; usd: number }[]
}

/** Returns start-of-day unix seconds for the timezone, given a "now" timestamp. */
export function startOfDay(now: number, tz: string): number {
  if (tz !== 'Asia/Shanghai') {
    throw new Error(`Unsupported timezone: ${tz}. MVP only handles Asia/Shanghai.`)
  }
  const offsetSec = 8 * 3600
  const local = now + offsetSec
  const localDayStart = local - (local % 86400)
  return localDayStart - offsetSec
}

type ToolRow = {
  tool: 'claude_code' | 'codex' | 'cursor' | 'gemini'
  tokens: number
  usd: number
}

export async function aggregateToday(db: Db, now: number, tz: string): Promise<TodayResult> {
  const todayStart = startOfDay(now, tz)

  const rows = await db.all<ToolRow>(
    sql`
      SELECT
        tool,
        CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS tokens,
        COALESCE(SUM(usd_cost), 0) AS usd
      FROM events
      WHERE ts >= ${todayStart}
      GROUP BY tool
      ORDER BY tokens DESC
    `,
  )

  const tools = rows.map((r) => ({ name: r.tool, tokens: r.tokens, usd: r.usd }))
  const total_tokens = tools.reduce((acc, t) => acc + t.tokens, 0)
  const total_usd = tools.reduce((acc, t) => acc + t.usd, 0)
  return { total_tokens, total_usd, tools }
}

export type MonthResult = { total_tokens: number; total_usd: number }

/** Returns start-of-month unix seconds for the timezone. */
export function startOfMonth(now: number, tz: string): number {
  if (tz !== 'Asia/Shanghai') {
    throw new Error(`Unsupported timezone: ${tz}. MVP only handles Asia/Shanghai.`)
  }
  const offsetSec = 8 * 3600
  const localMs = (now + offsetSec) * 1000
  const d = new Date(localMs)
  const firstUtcMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  return firstUtcMs / 1000 - offsetSec
}

export async function aggregateMonth(db: Db, now: number, tz: string): Promise<MonthResult> {
  const monthStart = startOfMonth(now, tz)
  const row = await db.get<{ tokens: number; usd: number }>(
    sql`
      SELECT
        CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS tokens,
        COALESCE(SUM(usd_cost), 0) AS usd
      FROM events
      WHERE ts >= ${monthStart}
    `,
  )
  return { total_tokens: row?.tokens ?? 0, total_usd: row?.usd ?? 0 }
}
