import { oc } from '@orpc/contract'
import { implement } from '@orpc/server'
import { z } from 'zod'
import type { Env } from '../env'

export const TOOLS = ['claude_code', 'codex', 'cursor', 'gemini'] as const
export const QUOTE_CATEGORIES = ['computing', 'poetry-tang', 'scifi', 'philosophy'] as const

const toolEnum = z.enum(TOOLS)

export const eventSchema = z.object({
  tool: toolEnum,
  event_uuid: z.string().min(1).max(128),
  ts: z.number().int(),
  model: z.string().nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_tokens: z.number().int().nonnegative().default(0),
  reasoning_output_tokens: z.number().int().nonnegative().default(0),
})
export type EventInput = z.infer<typeof eventSchema>

export const summaryResponseSchema = z.object({
  today: z.object({
    total_tokens: z.number().int(),
    total_usd: z.number(),
    tools: z.array(
      z.object({
        name: toolEnum,
        tokens: z.number().int(),
        usd: z.number(),
        sparkline_7d: z.array(z.number().int()).length(7),
      }),
    ),
  }),
  month: z.object({
    total_tokens: z.number().int(),
    total_usd: z.number(),
  }),
  sparkline_7d: z.array(z.number().int()).length(7),
  quote: z.object({
    text: z.string(),
    attr: z.string(),
    category: z.enum(QUOTE_CATEGORIES),
    lang: z.enum(['en', 'zh']),
  }),
  sync_ts: z.number().int(),
  fallback_priced_tokens: z.number().int().nonnegative().default(0),
})
export type SummaryResponse = z.infer<typeof summaryResponseSchema>

export const tokeiContract = oc
  .prefix('/v1')
  .tag('Tokei')
  .router({
    ingest: oc
      .route({ method: 'POST', path: '/ingest' })
      .input(
        z.object({
          device_id: z.string().min(1).max(64),
          events: z.array(eventSchema).min(1).max(500),
        }),
      )
      .output(
        z.object({
          accepted: z.number().int().nonnegative(),
          deduped: z.number().int().nonnegative(),
        }),
      )
      .errors({
        UNAUTHORIZED: { status: 401, message: 'Missing or invalid bearer token' },
        CLOCK_SKEW: { status: 422, message: 'Event timestamp skewed > 1 day from server time' },
      }),

    summary: oc
      .route({ method: 'GET', path: '/summary' })
      .output(summaryResponseSchema)
      .errors({
        UNAUTHORIZED: { status: 401, message: 'Missing or invalid bearer token' },
      }),
  })

export type HandlerContext = {
  env: Env
  db: D1Database
  request: Request
}

export const os = implement(tokeiContract).$context<HandlerContext>()
