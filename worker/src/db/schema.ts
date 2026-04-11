import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core'

export const events = sqliteTable(
  'events',
  {
    deviceId: text('device_id').notNull(),
    tool: text('tool', { enum: ['claude_code', 'codex', 'cursor', 'gemini'] }).notNull(),
    eventUuid: text('event_uuid').notNull(),
    ts: integer('ts').notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    reasoningOutputTokens: integer('reasoning_output_tokens').notNull().default(0),
    usdCost: real('usd_cost'),
    usedFallbackPrice: integer('used_fallback_price', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.deviceId, t.tool, t.eventUuid] }),
    tsToolIdx: index('idx_events_ts_tool').on(t.ts, t.tool),
  }),
)

export const prices = sqliteTable('prices', {
  model: text('model').primaryKey(),
  inputCostPerToken: real('input_cost_per_token').notNull(),
  outputCostPerToken: real('output_cost_per_token').notNull(),
  cacheReadInputTokenCost: real('cache_read_input_token_cost'),
  cacheCreationInputTokenCost: real('cache_creation_input_token_cost'),
  updatedAt: integer('updated_at').notNull(),
})

export const quotes = sqliteTable('quotes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  attr: text('attr'),
  category: text('category', {
    enum: ['computing', 'poetry-tang', 'scifi', 'philosophy'],
  }).notNull(),
  lang: text('lang', { enum: ['en', 'zh'] }).notNull().default('en'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
})
