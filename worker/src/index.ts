import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { tokeiRouter } from './router'
import { fetchAndStorePrices } from './cron/fetchPrices'
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from './env'

const openApiHandler = new OpenAPIHandler(tokeiRouter)

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { matched, response } = await openApiHandler.handle(request, {
      context: { env, db: env.DB, request },
    })
    if (matched) return response
    return new Response('Not Found', { status: 404 })
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const db = drizzle(env.DB)
          const n = await fetchAndStorePrices(db, env.LITELLM_PRICE_URL)
          console.log(`fetchAndStorePrices: stored ${n} rows`)
        } catch (e) {
          console.error('scheduled fetchAndStorePrices failed', e)
        }
      })(),
    )
  },
}
