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

/** Returns 7 k-token values, oldest first. Missing days are filled with 0. */
export async function sparkline7d(db: Db, now: number, tz: string): Promise<number[]> {
  const todayStart = startOfDay(now, tz)
  const sixDaysAgoStart = todayStart - 6 * 86400

  const rows = await db.all<{ day_start: number; tokens: number }>(
    sql`
      SELECT
        CAST((ts - ((ts + 28800) % 86400)) AS INTEGER) AS day_start,
        CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS tokens
      FROM events
      WHERE ts >= ${sixDaysAgoStart}
      GROUP BY day_start
    `,
  )

  const byDay = new Map<number, number>()
  for (const r of rows) byDay.set(r.day_start, r.tokens)

  const result: number[] = []
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * 86400
    const tokens = byDay.get(dayStart) ?? 0
    result.push(Math.round(tokens / 1000))
  }
  return result
}

export type ToolSparkline = { name: string; sparkline: number[] }

export async function sparkline7dPerTool(db: Db, now: number, tz: string): Promise<ToolSparkline[]> {
  const todayStart = startOfDay(now, tz)
  const sixDaysAgoStart = todayStart - 6 * 86400

  const rows = await db.all<{ tool: string; day_start: number; tokens: number }>(
    sql`
      SELECT
        tool,
        CAST((ts - ((ts + 28800) % 86400)) AS INTEGER) AS day_start,
        CAST(COALESCE(SUM(input_tokens + output_tokens + cached_input_tokens + cache_creation_tokens + reasoning_output_tokens), 0) AS INTEGER) AS tokens
      FROM events
      WHERE ts >= ${sixDaysAgoStart}
      GROUP BY tool, day_start
    `,
  )

  const byToolDay = new Map<string, Map<number, number>>()
  const tools = new Set<string>()
  for (const r of rows) {
    tools.add(r.tool)
    let dayMap = byToolDay.get(r.tool)
    if (!dayMap) { dayMap = new Map(); byToolDay.set(r.tool, dayMap) }
    dayMap.set(r.day_start, r.tokens)
  }

  const result: ToolSparkline[] = []
  for (const tool of tools) {
    const dayMap = byToolDay.get(tool) ?? new Map<number, number>()
    const sparkline: number[] = []
    for (let i = 6; i >= 0; i--) {
      const dayStart = todayStart - i * 86400
      sparkline.push(Math.round((dayMap.get(dayStart) ?? 0) / 1000))
    }
    result.push({ name: tool, sparkline })
  }
  return result
}
